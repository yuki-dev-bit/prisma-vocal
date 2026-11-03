/**
 * Utilidades matemáticas puras usadas pelo núcleo de DSP.
 * Sem dependências, sem DOM — testável em Node.
 */

export const clamp = (v: number, min: number, max: number): number =>
  v < min ? min : v > max ? max : v;

export const mean = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Percentil por interpolação linear (p em 0..100). */
export function percentile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 1) return s[0];
  const idx = (clamp(p, 0, 100) / 100) * (s.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export const stdDev = (xs: readonly number[]): number => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
};

export const hzToSemitones = (hz: number, ref = 130.8127826502993): number =>
  hz > 0 ? 12 * Math.log2(hz / ref) : Number.NEGATIVE_INFINITY;

export const semitonesToHz = (st: number, ref = 130.8127826502993): number =>
  ref * Math.pow(2, st / 12);

export const hzToMidi = (hz: number): number => 69 + 12 * Math.log2(hz / 440);

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

/** Nome de nota científica (ex.: 110 Hz → "A2"). */
export function noteName(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return '—';
  const midi = Math.round(hzToMidi(hz));
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

export const dbToLinear = (db: number): number => Math.pow(10, db / 20);
export const linearToDb = (v: number): number => (v <= 1e-12 ? -120 : 20 * Math.log10(v));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Suavização exponencial com fator de tempo constante (ms). */
export function ema(prev: number, next: number, dtMs: number, tauMs: number): number {
  if (tauMs <= 0) return next;
  const k = 1 - Math.exp(-dtMs / tauMs);
  return prev + (next - prev) * k;
}

/**
 * Média móvel centrada sobre um buffer de floats (anti-alias simples).
 *
 * O divisor é o número de amostras realmente dentro da janela: no fim do
 * buffer algumas já saíram, e dividir por `window` ali atenuava a cauda
 * (com sinal constante, as últimas `window >> 1` amostras saíam menores).
 */
export function movingAverage(xs: Float32Array, window: number): Float32Array {
  if (window <= 1) return xs.slice();
  const out = new Float32Array(xs.length);
  let acc = 0;
  const half = window >> 1;
  for (let i = 0; i < xs.length + half; i++) {
    if (i < xs.length) acc += xs[i];
    if (i - window >= 0) acc -= xs[i - window];
    const target = i - half;
    if (target >= 0) {
      const entraram = Math.min(i + 1, xs.length);
      const sairam = Math.max(0, i - window + 1);
      out[target] = acc / Math.max(1, entraram - sairam);
    }
  }
  return out;
}

/** Gera um id curto e ordenável, sem depender de crypto (fallback). */
export function shortId(prefix = ''): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `${prefix}${ts}${rnd}`;
}
