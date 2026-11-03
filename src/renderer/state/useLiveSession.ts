/**
 * Sessão de áudio ao vivo: liga microfone → AudioWorklet → analisador DSP.
 *
 * Otimização importante: os quadros de 16 ms NÃO passam por estado React.
 * Eles vão para um `LiveBuffer` que os canvases leem via requestAnimationFrame.
 * O React só recebe leituras numéricas a 10 Hz — suficiente para o HUD e evita
 * re-renderizar 60 vezes por segundo.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioEngine,
  AudioEngineError,
  type AudioDeviceInfo,
  type AudioEngineErrorKind,
} from '../../audio/AudioEngine';
import { Recorder } from '../../audio/Recorder';
import {
  VoiceAnalyzer,
  aggregateFrames,
  type SessionAnalysisOptions,
} from '../../core/analysis/analyzer';
import type { FrameMetrics, SessionMetrics } from '../../shared/types';
import { presetForProfile } from '../../core/settings/defaults';
import { useStore } from './store';

export const RING_SIZE = 900; // ≈ 14 s de histórico em 16 ms/quadro

export class LiveBuffer {
  readonly frames: (FrameMetrics | null)[] = new Array(RING_SIZE).fill(null);
  head = 0;
  count = 0;

  push(frame: FrameMetrics): void {
    this.frames[this.head] = frame;
    this.head = (this.head + 1) % RING_SIZE;
    this.count = Math.min(this.count + 1, RING_SIZE);
  }

  /** Itera do mais antigo para o mais recente. */
  forEach(cb: (frame: FrameMetrics, index: number) => void): void {
    const start = this.count < RING_SIZE ? 0 : this.head;
    for (let i = 0; i < this.count; i++) {
      const frame = this.frames[(start + i) % RING_SIZE];
      if (frame) cb(frame, i);
    }
  }

  get latest(): FrameMetrics | null {
    if (this.count === 0) return null;
    return this.frames[(this.head - 1 + RING_SIZE) % RING_SIZE];
  }

  reset(): void {
    this.frames.fill(null);
    this.head = 0;
    this.count = 0;
  }
}

export interface LiveReadout {
  f0: number | null;
  voiced: boolean;
  levelDb: number;
  splDb: number | null;
  hnrDb: number | null;
  resonance: number;
  breathiness: number;
  formants: [number, number, number, number] | null;
  clipping: boolean;
  peak: number;
}

const EMPTY_READOUT: LiveReadout = {
  f0: null,
  voiced: false,
  levelDb: -120,
  splDb: null,
  hnrDb: null,
  resonance: 0,
  breathiness: 0,
  formants: null,
  clipping: false,
  peak: 0,
};

export type LiveStatus = 'idle' | 'starting' | 'running' | 'error';

export interface SessionResult {
  metrics: SessionMetrics;
  frames: FrameMetrics[];
  pcm: Float32Array | null;
  sampleRate: number;
  durationSec: number;
}

export interface UseLiveSession {
  status: LiveStatus;
  error: string | null;
  /** Categoria do erro (permission, busy, device…), para a UI orientar a ação certa. */
  errorKind: AudioEngineErrorKind | null;
  readout: LiveReadout;
  elapsedSec: number;
  recording: boolean;
  buffer: LiveBuffer;
  devices: AudioDeviceInfo[];
  refreshDevices: () => Promise<void>;
  /** Mediana do nível (dBFS) dos últimos quadros — base estável para calibrar. */
  recentLevelDb: (frames?: number) => number | null;
  start: (opts?: { record?: boolean }) => Promise<boolean>;
  stop: (analysisOpts?: SessionAnalysisOptions) => SessionResult | null;
  discard: () => void;
  toggleRecording: () => void;
  playTone: (hz: number, ms?: number) => void;
  sampleRate: number;
  latencyMs: number;
  bounds: { minF0: number; maxF0: number; hudMin: number; hudMax: number };
}

export function useLiveSession(): UseLiveSession {
  const { settings, data, pushBanner } = useStore();
  const preset = useMemo(() => presetForProfile(data.profile), [data.profile]);
  const bounds = useMemo(
    () => ({
      minF0: preset.analysis.minF0,
      maxF0: preset.analysis.maxF0,
      hudMin: preset.hud.minHz,
      hudMax: preset.hud.maxHz,
    }),
    [preset],
  );

  const engineRef = useRef<AudioEngine | null>(null);
  const analyzerRef = useRef<VoiceAnalyzer | null>(null);
  const recorderRef = useRef<Recorder>(new Recorder());
  const bufferRef = useRef<LiveBuffer>(new LiveBuffer());
  const sessionFrames = useRef<FrameMetrics[]>([]);
  const unsubscribe = useRef<(() => void) | null>(null);
  const latestRef = useRef<FrameMetrics | null>(null);
  const peakRef = useRef(0);
  const startedAt = useRef(0);

  const [status, setStatus] = useState<LiveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<AudioEngineErrorKind | null>(null);
  const [readout, setReadout] = useState<LiveReadout>(EMPTY_READOUT);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [recording, setRecording] = useState(false);
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [sampleRate, setSampleRate] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);

  /**
   * Mediana do nível recente. Calibrar com o valor instantâneo é frágil: um
   * único quadro silencioso (-120 dBFS) gera um offset absurdo. A mediana de
   * ~0,6 s (40 quadros) ignora pausas curtas e exige som sustentado.
   */
  const recentLevelDb = useCallback((frames = 40): number | null => {
    const levels: number[] = [];
    bufferRef.current.forEach((f) => {
      if (Number.isFinite(f.levelDb)) levels.push(f.levelDb);
    });
    if (levels.length < 8) return null;
    const tail = levels.slice(-frames).sort((a, b) => a - b);
    return tail[Math.floor(tail.length / 2)];
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await AudioEngine.listDevices());
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    void refreshDevices();
    const md = navigator.mediaDevices;
    if (!md?.addEventListener) return;
    const onChange = () => void refreshDevices();
    md.addEventListener('devicechange', onChange);
    return () => md.removeEventListener('devicechange', onChange);
  }, [refreshDevices]);

  /* ---------------------------- loop de leitura ---------------------------- */

  useEffect(() => {
    if (status !== 'running') return;
    const id = window.setInterval(() => {
      const f = latestRef.current;
      const engine = engineRef.current;
      setElapsedSec(startedAt.current ? (performance.now() - startedAt.current) / 1000 : 0);
      setLatencyMs(engine?.baseLatencyMs ?? 0);
      if (!f) return;
      setReadout({
        f0: f.f0,
        voiced: f.voiced,
        levelDb: f.levelDb,
        splDb: f.splDb,
        hnrDb: f.hnrDb,
        resonance: f.resonanceIndex,
        breathiness: f.breathiness,
        formants: f.formants,
        clipping: f.clipping || peakRef.current > 0.995,
        peak: peakRef.current,
      });
    }, 100);
    return () => window.clearInterval(id);
  }, [status]);

  /* ------------------- calibração aplicada em tempo real ------------------- */

  /**
   * O analisador é criado no start() com o offset vigente. Sem este efeito,
   * calibrar durante a captura só teria efeito no próximo start — parecia que
   * o valor não havia sido salvo.
   */
  useEffect(() => {
    analyzerRef.current?.setCalibrationOffset(settings.audio.calibrationOffsetDb);
  }, [settings.audio.calibrationOffsetDb, status]);

  /* ---------------------------- ciclo de vida ---------------------------- */

  const stopEngine = useCallback(async () => {
    unsubscribe.current?.();
    unsubscribe.current = null;
    const engine = engineRef.current;
    engineRef.current = null;
    await engine?.stop();
    setStatus('idle');
  }, []);

  useEffect(() => {
    return () => {
      void stopEngine();
    };
  }, [stopEngine]);

  const start = useCallback(
    async (opts: { record?: boolean } = {}): Promise<boolean> => {
      setError(null);
      setErrorKind(null);
      setStatus('starting');
      try {
        await stopEngine();
        const engine = new AudioEngine();
        engineRef.current = engine;

        const analyzer = new VoiceAnalyzer({
          fs: settings.audio.requestedSampleRate,
          calibrationOffsetDb: settings.audio.calibrationOffsetDb,
          minF0: bounds.minF0,
          maxF0: bounds.maxF0,
        });
        analyzerRef.current = analyzer;
        bufferRef.current.reset();
        sessionFrames.current = [];
        latestRef.current = null;
        peakRef.current = 0;

        await engine.start({
          deviceId: settings.audio.inputDeviceId,
          gainDb: settings.audio.gainDb,
          gateDb: settings.audio.noiseGateThresholdDb,
          gateEnabled: settings.audio.noiseSuppression,
          noiseSuppression: false, // o filtro do navegador distorce medidas acústicas
          monitoring: settings.audio.monitoring,
          monitoringVolume: settings.audio.monitoringVolume,
          latencyHint: settings.audio.latencyHint,
          requestedSampleRate: settings.audio.requestedSampleRate,
        });

        // reconstrói o analisador com a taxa real do dispositivo
        analyzerRef.current = new VoiceAnalyzer({
          fs: engine.sampleRate,
          calibrationOffsetDb: settings.audio.calibrationOffsetDb,
          minF0: bounds.minF0,
          maxF0: bounds.maxF0,
        });
        setSampleRate(engine.sampleRate);

        if (opts.record) {
          recorderRef.current.start(engine.sampleRate);
          setRecording(true);
        }

        unsubscribe.current = engine.onBlock((samples, meta) => {
          const an = analyzerRef.current;
          if (!an) return;
          const frames = an.push(samples);
          for (const f of frames) {
            bufferRef.current.push(f);
            sessionFrames.current.push(f);
            latestRef.current = f;
          }
          peakRef.current = meta.peak;
          if (recorderRef.current.recording) {
            const keep = recorderRef.current.push(samples);
            if (!keep) {
              setRecording(false);
              pushBanner({
                kind: 'warn',
                message:
                  'Limite de 12 minutos de gravação atingido — a gravação foi encerrada automaticamente.',
              });
            }
          }
        });

        // detecta microfone desconectado durante o uso
        const track = engine.mediaStream?.getAudioTracks?.()[0];
        if (track) {
          track.addEventListener('ended', () => {
            pushBanner({
              kind: 'warn',
              message: 'O microfone foi desconectado. Reconecte e reinicie a captura.',
            });
            void stopEngine();
            setStatus('error');
            setError('Microfone desconectado.');
          });
        }

        startedAt.current = performance.now();
        setStatus('running');
        void refreshDevices();
        return true;
      } catch (err) {
        const kind: AudioEngineErrorKind = err instanceof AudioEngineError ? err.kind : 'unknown';
        setError(describeAudioFailure(err, kind));
        setErrorKind(kind);
        await stopEngine();
        setStatus('error');
        return false;
      }
    },
    [bounds.maxF0, bounds.minF0, pushBanner, refreshDevices, settings.audio, stopEngine],
  );

  const stop = useCallback(
    (analysisOpts: SessionAnalysisOptions = {}): SessionResult | null => {
      const frames = sessionFrames.current.slice();
      const rec = recorderRef.current.recording
        ? recorderRef.current.stop()
        : {
            pcm: null as unknown as Float32Array,
            sampleRate: sampleRate || 48000,
            durationSec: elapsedSec,
          };
      setRecording(false);
      void stopEngine();
      if (frames.length === 0) return null;
      const durationSec = frames.length > 0 ? frames[frames.length - 1].t + 0.016 : rec.durationSec;
      const metrics = aggregateFrames(frames, Math.max(durationSec, rec.durationSec ?? 0), {
        ...analysisOpts,
        calibrationOffsetDb: settings.audio.calibrationOffsetDb,
      });
      return {
        metrics,
        frames,
        pcm: rec.pcm ?? null,
        sampleRate: rec.sampleRate,
        durationSec,
      };
    },
    [elapsedSec, sampleRate, settings.audio.calibrationOffsetDb, stopEngine],
  );

  const discard = useCallback(() => {
    recorderRef.current.cancel();
    sessionFrames.current = [];
    bufferRef.current.reset();
    setRecording(false);
    void stopEngine();
  }, [stopEngine]);

  const toggleRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (rec.recording) {
      setRecording(false);
      rec.cancel();
    } else if (status === 'running') {
      rec.start(sampleRate || settings.audio.requestedSampleRate);
      setRecording(true);
    }
  }, [sampleRate, settings.audio.requestedSampleRate, status]);

  const playTone = useCallback((hz: number, ms = 900) => {
    void engineRef.current?.playTone(hz, ms, 0.22);
    if (!engineRef.current) {
      // motor parado: cria contexto temporário só para o tom de referência
      const engine = new AudioEngine();
      void engine.playTone(hz, ms, 0.22);
    }
  }, []);

  return {
    status,
    error,
    errorKind,
    readout,
    elapsedSec,
    recording,
    buffer: bufferRef.current,
    devices,
    refreshDevices,
    recentLevelDb,
    start,
    stop,
    discard,
    toggleRecording,
    playTone,
    sampleRate,
    latencyMs,
    bounds,
  };
}

/**
 * Mensagem de falha acionável. O mesmo `NotAllowedError` significa coisas
 * diferentes no desktop (usuário negou) e no Android (permissão do app
 * desligada, ou o WebView memorizou uma negativa anterior) — o texto precisa
 * dizer o que fazer em cada caso.
 */
export function describeAudioFailure(err: unknown, kind: AudioEngineErrorKind): string {
  const base =
    err instanceof AudioEngineError
      ? err.message
      : `Falha ao iniciar a captura: ${(err as Error)?.message ?? 'erro desconhecido'}`;
  if (kind !== 'permission') return base;

  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
  if (isAndroid) {
    return [
      'O Android não liberou o microfone para o Prisma Vocal.',
      'Confira em Ajustes → Apps → Prisma Vocal → Permissões → Microfone.',
      'Se já estiver permitido, feche o app pelo seletor de apps e abra de novo:',
      'o WebView guarda a última negativa até o app ser reiniciado.',
    ].join(' ');
  }
  return [
    'O navegador/sistema bloqueou o microfone.',
    'Clique no ícone de permissões na barra de endereço, permita o microfone e recarregue a página.',
  ].join(' ');
}
