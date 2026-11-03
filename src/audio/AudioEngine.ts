/**
 * Motor de áudio do renderer (Web Audio API + AudioWorklet).
 *
 * Por que Web Audio no renderer em vez de DSP no processo principal?
 *  • latência baixa (worklet na thread de áudio do Chromium);
 *  • acesso direto a enumerar/selecionar dispositivos;
 *  • o mesmo código roda na versão desktop (Electron) e no modo navegador.
 *
 * O motor NÃO grava em disco: apenas entrega blocos de amostras. A persistência
 * é decidida pela camada de armazenamento (no processo principal, criptografada).
 */

// `?url` faz o Vite emitir o worklet como arquivo próprio em `dist/assets/`.
import workletUrl from './capture-processor.js?url';

export interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: 'audioinput' | 'audiooutput';
}

export interface AudioEngineConfig {
  deviceId: string | null;
  gainDb: number;
  gateDb: number;
  gateEnabled: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  monitoring: boolean;
  monitoringVolume: number;
  latencyHint: 'interactive' | 'balanced' | 'playback';
  requestedSampleRate: number;
}

export type AudioEngineStatus = 'idle' | 'starting' | 'running' | 'suspended' | 'error';

export interface AudioBlockMeta {
  peak: number;
  rms: number;
  clipped: number;
  t: number;
}

export type BlockListener = (samples: Float32Array, meta: AudioBlockMeta) => void;

const DEFAULT_CONFIG: AudioEngineConfig = {
  deviceId: null,
  gainDb: 0,
  gateDb: -55,
  gateEnabled: false,
  noiseSuppression: false,
  echoCancellation: false,
  monitoring: false,
  monitoringVolume: 0.4,
  latencyHint: 'interactive',
  requestedSampleRate: 48000,
};

/**
 * Categorias de falha que a interface precisa distinguir, porque cada uma pede
 * uma ação diferente do usuário:
 *  • permission → autorizar o microfone (ou reabrir o app se o WebView cacheou a negativa);
 *  • busy       → outro app está usando o microfone;
 *  • device     → o dispositivo escolhido sumiu/está indisponível;
 *  • unsupported→ ambiente sem Web Audio/AudioWorklet;
 *  • unknown    → erro não classificado.
 */
export type AudioEngineErrorKind = 'permission' | 'busy' | 'device' | 'unsupported' | 'unknown';

export class AudioEngineError extends Error {
  readonly kind: AudioEngineErrorKind;
  constructor(kind: AudioEngineErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'AudioEngineError';
  }
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private monitorGain: GainNode | null = null;
  private config: AudioEngineConfig = { ...DEFAULT_CONFIG };
  private listeners = new Set<BlockListener>();
  private _status: AudioEngineStatus = 'idle';
  private startTime = 0;
  private received = 0;

  get status(): AudioEngineStatus {
    return this._status;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 0;
  }

  get baseLatencyMs(): number {
    if (!this.ctx) return 0;
    const base = (this.ctx.baseLatency ?? 0) * 1000;
    const output =
      'outputLatency' in this.ctx
        ? Number((this.ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0) * 1000
        : 0;
    return Math.round(base + output);
  }

  /** Stream ativo (usado para detectar desconexão do dispositivo). */
  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  get configSnapshot(): AudioEngineConfig {
    return { ...this.config };
  }

  onBlock(listener: BlockListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Lista dispositivos. Rótulos só aparecem depois da permissão do microfone. */
  static async listDevices(): Promise<AudioDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) {
      throw new AudioEngineError('unsupported', 'Este ambiente não expõe dispositivos de áudio.');
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
      .map((d, index) => ({
        deviceId: d.deviceId,
        label: d.label || `${d.kind === 'audioinput' ? 'Microfone' : 'Saída'} ${index + 1}`,
        kind: d.kind as 'audioinput' | 'audiooutput',
      }));
  }

  /**
   * Abre o microfone traduzindo o erro do navegador/WebView em uma categoria
   * acionável. Antes, `NotReadableError` (microfone ocupado por outro app, muito
   * comum no Android) chegava como "device" com a mensagem crua do Chromium.
   */
  private async openStream(constraints: MediaStreamConstraints): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      const name = (err as DOMException)?.name ?? '';
      const detail = (err as Error)?.message ? ` (${(err as Error).message})` : '';

      if (
        name === 'NotAllowedError' ||
        name === 'SecurityError' ||
        name === 'PermissionDeniedError'
      ) {
        throw new AudioEngineError(
          'permission',
          'O sistema não liberou o microfone para o app. Autorize o microfone nas permissões do aplicativo e tente de novo.',
        );
      }
      if (name === 'NotSupportedError') {
        // Acontece em WebView antigo/headless: a API existe, mas a captura não.
        throw new AudioEngineError(
          'unsupported',
          'Este ambiente não suporta captura de áudio (WebView sem suporte a microfone). Atualize o app/navegador.',
        );
      }
      if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
        throw new AudioEngineError(
          'busy',
          `O microfone está ocupado por outro aplicativo (chamada, gravador ou assistente).${detail}`,
        );
      }
      if (name === 'OverconstrainedError' || name === 'NotFoundError') {
        // Dispositivo salvo não existe mais (ou só aceita outro formato):
        // tenta o padrão do sistema antes de desistir.
        try {
          return await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: false,
              noiseSuppression: this.config.noiseSuppression,
              autoGainControl: false,
            },
            video: false,
          });
        } catch (fallbackErr) {
          const fallbackName = (fallbackErr as DOMException)?.name ?? '';
          if (fallbackName === 'NotAllowedError' || fallbackName === 'SecurityError') {
            throw new AudioEngineError(
              'permission',
              'O sistema não liberou o microfone para o app.',
            );
          }
          throw new AudioEngineError(
            'device',
            `Nenhum microfone disponível para captura.${detail || (fallbackErr as Error)?.message ? ` (${(fallbackErr as Error).message})` : ''}`,
          );
        }
      }
      throw new AudioEngineError('device', `Falha ao abrir o microfone${detail || '.'}`);
    }
  }

  /**
   * Estado da permissão de microfone, quando o ambiente informa.
   *
   * Importante: `unknown` NÃO significa negado. O WebView do Android não
   * implementa `navigator.permissions.query` para microfone e a API pode
   * lançar — tratar isso como "negado" foi parte do falso negativo que
   * aparecia no celular.
   */
  static async permissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
    try {
      const perms = navigator.permissions;
      if (!perms?.query) return 'unknown';
      const status = await perms.query({ name: 'microphone' as PermissionName });
      return status.state;
    } catch {
      return 'unknown';
    }
  }

  async start(config: Partial<AudioEngineConfig> = {}): Promise<void> {
    this.config = { ...this.config, ...config };
    this._status = 'starting';
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new AudioEngineError('unsupported', 'Captura de áudio indisponível neste ambiente.');
      }
      await this.stop();

      const constraints: MediaStreamConstraints = {
        audio: {
          deviceId: this.config.deviceId ? { exact: this.config.deviceId } : undefined,
          echoCancellation: this.config.echoCancellation,
          noiseSuppression: this.config.noiseSuppression,
          autoGainControl: false, // ganho é controlado por nós
          channelCount: 1,
          sampleRate: this.config.requestedSampleRate,
        },
        video: false,
      };

      this.stream = await this.openStream(constraints);

      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new AudioEngineError('unsupported', 'Web Audio API indisponível.');
      this.ctx = new Ctor({ latencyHint: this.config.latencyHint });

      if (!this.ctx.audioWorklet) {
        throw new AudioEngineError(
          'unsupported',
          'AudioWorklet indisponível — atualize o navegador/Electron.',
        );
      }
      // `?url` emite o worklet como arquivo próprio em `dist/assets/`. Não use
      // `new URL('./x.js', import.meta.url)`: arquivos pequenos seriam embutidos
      // como `data:` URL e a CSP (`script-src 'self'`) os bloquearia.
      await this.ctx.audioWorklet.addModule(workletUrl);

      this.source = this.ctx.createMediaStreamSource(this.stream);
      this.worklet = new AudioWorkletNode(this.ctx, 'prisma-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
        channelCountMode: 'explicit',
      });
      this.monitorGain = this.ctx.createGain();
      this.monitorGain.gain.value = this.config.monitoring ? this.config.monitoringVolume : 0;

      this.source.connect(this.worklet);
      this.worklet.connect(this.monitorGain);
      this.monitorGain.connect(this.ctx.destination);

      this.worklet.port.onmessage = (event: MessageEvent) => {
        const data = event.data as {
          type: string;
          samples?: Float32Array;
          peak?: number;
          rms?: number;
          clipped?: number;
        };
        if (data?.type !== 'block' || !data.samples) return;
        this.received++;
        const meta: AudioBlockMeta = {
          peak: data.peak ?? 0,
          rms: data.rms ?? 0,
          clipped: data.clipped ?? 0,
          t: this.ctx ? this.ctx.currentTime - this.startTime : 0,
        };
        for (const l of this.listeners) l(data.samples, meta);
      };

      this.pushConfig();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.startTime = this.ctx.currentTime;
      this._status = 'running';
    } catch (err) {
      this._status = 'error';
      await this.stop();
      throw err instanceof AudioEngineError
        ? err
        : new AudioEngineError(
            'unknown',
            `Não foi possível iniciar o áudio: ${(err as Error).message}`,
          );
    }
  }

  /** Aplica mudanças de configuração sem reabrir o dispositivo. */
  update(config: Partial<AudioEngineConfig>): void {
    const needsRestart =
      (config.deviceId !== undefined && config.deviceId !== this.config.deviceId) ||
      (config.noiseSuppression !== undefined &&
        config.noiseSuppression !== this.config.noiseSuppression) ||
      (config.latencyHint !== undefined && config.latencyHint !== this.config.latencyHint) ||
      (config.requestedSampleRate !== undefined &&
        config.requestedSampleRate !== this.config.requestedSampleRate);

    this.config = { ...this.config, ...config };

    if (needsRestart) {
      void this.start(this.config).catch(() => undefined);
      return;
    }
    this.pushConfig();
  }

  private pushConfig(): void {
    if (!this.worklet) return;
    this.worklet.port.postMessage({
      type: 'config',
      gain: Math.pow(10, this.config.gainDb / 20),
      gateDb: this.config.gateDb,
      gateEnabled: this.config.gateEnabled,
      monitorVolume: this.config.monitoring ? this.config.monitoringVolume : 0,
    });
    if (this.monitorGain && this.ctx) {
      const target = this.config.monitoring ? this.config.monitoringVolume : 0;
      this.monitorGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.03);
    }
  }

  async stop(): Promise<void> {
    try {
      this.worklet?.port.close();
      this.worklet?.disconnect();
      this.source?.disconnect();
      this.monitorGain?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* encerramento best-effort */
    }
    this.worklet = null;
    this.source = null;
    this.monitorGain = null;
    this.stream = null;
    if (this.ctx && this.ctx.state !== 'closed') {
      try {
        await this.ctx.close();
      } catch {
        /* ignore */
      }
    }
    this.ctx = null;
    this.received = 0;
    if (this._status !== 'error') this._status = 'idle';
  }

  /** Blocos recebidos desde o start (usado para detectar fluxo travado). */
  get blockCount(): number {
    return this.received;
  }

  /** Tom de referência (para exercícios com nota-alvo). */
  async playTone(hz: number, durationMs = 900, volume = 0.25): Promise<void> {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor || !(hz > 20 && hz < 5000)) return;
    const ctx = this.ctx ?? new Ctor();
    const ownContext = !this.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = hz;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(volume, now + 0.05);
    gain.gain.setValueAtTime(volume, now + durationMs / 1000 - 0.08);
    gain.gain.linearRampToValueAtTime(0, now + durationMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.05);
    if (ownContext) {
      setTimeout(() => void ctx.close().catch(() => undefined), durationMs + 300);
    }
  }

  /** Verifica se há fluxo de blocos (detecta microfone "mudo"/travado). */
  isFlowing(): boolean {
    return this._status === 'running' && this.received > 0;
  }
}
