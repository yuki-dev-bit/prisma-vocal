/**
 * Gravador simples de PCM float32 (mono) alimentado pelos blocos do worklet.
 *
 * Decisões:
 *  • não usa MediaRecorder (que produz Opus/WebM e dificulta análise e
 *    exportação WAV direta);
 *  • limite rígido de duração e de memória: 12 min ≈ 138 MB @48 kHz — acima
 *    disso paramos e avisamos, em vez de arriscar travar o app.
 */
export const MAX_RECORDING_SECONDS = 12 * 60;

export class Recorder {
  private chunks: Float32Array[] = [];
  private frames = 0;
  private sampleRate = 48000;
  private _recording = false;
  private overflowed = false;

  get recording(): boolean {
    return this._recording;
  }

  get durationSec(): number {
    return this.sampleRate > 0 ? this.frames / this.sampleRate : 0;
  }

  get didOverflow(): boolean {
    return this.overflowed;
  }

  start(sampleRate: number): void {
    this.chunks = [];
    this.frames = 0;
    this.sampleRate = sampleRate || 48000;
    this._recording = true;
    this.overflowed = false;
  }

  /** Recebe um bloco do worklet. Retorna false se o limite foi atingido. */
  push(samples: Float32Array): boolean {
    if (!this._recording) return true;
    if (this.durationSec >= MAX_RECORDING_SECONDS) {
      this._recording = false;
      this.overflowed = true;
      return false;
    }
    // cópia obrigatória: o buffer original é transferido entre threads
    this.chunks.push(new Float32Array(samples));
    this.frames += samples.length;
    return true;
  }

  stop(): { pcm: Float32Array; sampleRate: number; durationSec: number } {
    this._recording = false;
    const pcm = new Float32Array(this.frames);
    let offset = 0;
    for (const c of this.chunks) {
      pcm.set(c, offset);
      offset += c.length;
    }
    const durationSec = this.durationSec;
    this.chunks = [];
    this.frames = 0;
    return { pcm, sampleRate: this.sampleRate, durationSec };
  }

  /** Descarta sem materializar o PCM (economiza memória). */
  cancel(): void {
    this._recording = false;
    this.chunks = [];
    this.frames = 0;
  }
}
