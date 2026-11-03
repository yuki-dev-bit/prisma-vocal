/**
 * Descritores acústicos de quadro: nível, espectro, inclinação, H1-H2,
 * planura espectral e HNR.
 *
 * Todos os valores deste módulo são MEDIDAS ACÚSTICAS ou ESTIMATIVAS
 * derivadas diretamente do sinal — nunca diagnósticos clínicos.
 */
import { FFT, nextPowerOfTwo } from './fft';
import { hannWindow } from './window';
import { clamp, linearToDb } from '../utils/math';
import { normalizedAutocorrAtLag } from './yin';

export function rms(x: Float32Array, from = 0, to = x.length): number {
  let acc = 0;
  const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) acc += x[i] * x[i];
  return Math.sqrt(acc / n);
}

export const dbfs = (amplitude: number): number => linearToDb(amplitude);

export function zeroCrossingRate(x: Float32Array): number {
  let z = 0;
  for (let i = 1; i < x.length; i++) {
    if (x[i] >= 0 !== x[i - 1] >= 0) z++;
  }
  return x.length > 1 ? z / (x.length - 1) : 0;
}

export interface Spectrum {
  /** Magnitude linear (não normalizada) para bins 0..N/2. */
  magnitude: Float64Array;
  /** Frequência central de cada bin. */
  freqs: Float64Array;
  binHz: number;
  fs: number;
}

const specCache = new Map<
  number,
  { fft: FFT; re: Float64Array; im: Float64Array; win: Float64Array }
>();

function scratch(n: number) {
  let s = specCache.get(n);
  if (!s) {
    s = { fft: new FFT(n), re: new Float64Array(n), im: new Float64Array(n), win: hannWindow(n) };
    specCache.set(n, s);
  }
  return s;
}

export function clearFeatureCache(): void {
  specCache.clear();
}

/** Espectro de magnitude com janela de Hann. `fftSize` deve ser ≥ frame. */
export function magnitudeSpectrum(frame: Float32Array, fs: number, fftSize?: number): Spectrum {
  const n = fftSize ?? nextPowerOfTwo(Math.max(256, frame.length));
  const { fft, re, im, win } = scratch(n);
  re.fill(0);
  im.fill(0);
  const limit = Math.min(frame.length, n);
  for (let i = 0; i < limit; i++) re[i] = frame[i] * win[Math.min(i, win.length - 1)];
  fft.transform(re, im);
  const bins = (n >> 1) + 1;
  const magnitude = new Float64Array(bins);
  const freqs = new Float64Array(bins);
  const binHz = fs / n;
  for (let k = 0; k < bins; k++) {
    magnitude[k] = Math.hypot(re[k], im[k]) / (n / 4); // normalização p/ janela Hann
    freqs[k] = k * binHz;
  }
  return { magnitude, freqs, binHz, fs };
}

export function bandEnergy(spec: Spectrum, loHz: number, hiHz: number): number {
  let acc = 0;
  for (let k = 0; k < spec.magnitude.length; k++) {
    const f = spec.freqs[k];
    if (f >= loHz && f <= hiHz) acc += spec.magnitude[k] * spec.magnitude[k];
  }
  return acc;
}

export function spectralCentroid(spec: Spectrum, loHz = 60, hiHz = 6000): number {
  let num = 0;
  let den = 0;
  for (let k = 0; k < spec.magnitude.length; k++) {
    const f = spec.freqs[k];
    if (f < loHz || f > hiHz) continue;
    const p = spec.magnitude[k] * spec.magnitude[k];
    num += f * p;
    den += p;
  }
  return den > 1e-12 ? num / den : 0;
}

/**
 * Inclinação espectral por regressão linear de log-magnitude vs. oitavas,
 * na faixa 200 Hz – 5 kHz. Valores mais negativos = espectro mais "escuro".
 */
export function spectralTiltDbPerOct(spec: Spectrum, loHz = 200, hiHz = 4000): number {
  const xs: number[] = [];
  const ys: number[] = [];
  // Ignora bins abaixo de -60 dB do pico: sem isso, o piso de ruído e o
  // vazamento espectral dominam a regressão e invertem a leitura de brilho.
  let peak = 0;
  for (let k = 1; k < spec.magnitude.length; k++) peak = Math.max(peak, spec.magnitude[k]);
  const floor = peak * 1e-3;
  for (let k = 1; k < spec.magnitude.length; k++) {
    const f = spec.freqs[k];
    if (f < loHz || f > hiHz) continue;
    const m = spec.magnitude[k];
    if (m < floor) continue;
    xs.push(Math.log2(f));
    ys.push(20 * Math.log10(m));
  }
  const n = xs.length;
  if (n < 8) return 0;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) * (xs[i] - mx);
  }
  return den > 1e-12 ? num / den : 0;
}

/** Planura espectral (0 = tonal, 1 = ruído branco). */
export function spectralFlatness(spec: Spectrum, loHz = 100, hiHz = 6000): number {
  let logSum = 0;
  let linSum = 0;
  let count = 0;
  for (let k = 0; k < spec.magnitude.length; k++) {
    const f = spec.freqs[k];
    if (f < loHz || f > hiHz) continue;
    const p = spec.magnitude[k] + 1e-12;
    logSum += Math.log(p);
    linSum += p;
    count++;
  }
  if (count === 0 || linSum <= 0) return 1;
  const geo = Math.exp(logSum / count);
  const arit = linSum / count;
  return clamp(geo / arit, 0, 1);
}

/** Amplitude de um harmônico (máximo em torno de k*f0), em dB. */
export function harmonicLevelDb(
  spec: Spectrum,
  hz: number,
  toleranceHz = 30,
): { db: number; hz: number } | null {
  if (hz <= 0) return null;
  let best = -1;
  let bestMag = 0;
  for (let k = 0; k < spec.magnitude.length; k++) {
    const f = spec.freqs[k];
    if (Math.abs(f - hz) > toleranceHz) continue;
    if (spec.magnitude[k] > bestMag) {
      bestMag = spec.magnitude[k];
      best = k;
    }
  }
  if (best < 0 || bestMag <= 0) return null;
  return { db: 20 * Math.log10(bestMag), hz: spec.freqs[best] };
}

/**
 * H1-H2 (dB): diferença de amplitude entre o 1º e o 2º harmônico.
 * É um proxy clássico do "peso"/contato de pregas vocais — útil como
 * tendência relativa dentro da própria voz, não como valor absoluto.
 */
export function h1h2Db(spec: Spectrum, f0: number): number | null {
  const h1 = harmonicLevelDb(spec, f0, Math.max(20, f0 * 0.25));
  const h2 = harmonicLevelDb(spec, f0 * 2, Math.max(20, f0 * 0.25));
  if (!h1 || !h2) return null;
  return h1.db - h2.db;
}

/**
 * HNR (harmonic-to-noise ratio) pelo método da autocorrelação, seguindo a
 * linha de Boersma (1993): HNR = 10·log10(r/(1-r)), com r = pico da
 * autocorrelação normalizada na vizinhança do período.
 */
export function hnrDb(frame: Float32Array, fs: number, f0: number): number | null {
  if (!f0 || f0 <= 0) return null;
  const period = fs / f0;
  let best = 0;
  const from = Math.max(1, Math.floor(period) - 2);
  const to = Math.ceil(period) + 2;
  for (let lag = from; lag <= to; lag++) {
    const r = normalizedAutocorrAtLag(frame, lag);
    if (r > best) best = r;
  }
  const r = clamp(best, 0.001, 0.9999);
  return 10 * Math.log10(r / (1 - r));
}

/** Estimativa de soprosidade (0..1) a partir de HNR, inclinação e planura. */
export function breathinessIndex(args: {
  hnrDb: number | null;
  tiltDbPerOct: number;
  flatness: number;
  aperiodicity: number;
}): number {
  const hnr = args.hnrDb ?? 6;
  // HNR 25 dB → 0 ; HNR 2 dB → 1
  const byHnr = clamp((25 - hnr) / 23, 0, 1);
  // inclinaço muito negativa (< -14 dB/oct) indica mais energia de ruído
  const byTilt = clamp((-args.tiltDbPerOct - 8) / 12, 0, 1);
  const byFlat = clamp((args.flatness - 0.06) / 0.3, 0, 1);
  const byAper = clamp((args.aperiodicity - 0.08) / 0.3, 0, 1);
  return clamp(0.45 * byHnr + 0.2 * byTilt + 0.2 * byFlat + 0.15 * byAper, 0, 1);
}

/**
 * Índice de brilho/ressonância (0..100).
 *
 * Combina o centroide espectral normalizado pela própria f0 (para não
 * penalizar vozes graves) com a energia relativa na faixa de "presença"
 * (2–4 kHz). É um índice RELATIVO, pensado para comparar a mesma voz ao
 * longo do tempo — não uma medida absoluta de "voz boa".
 */
export function resonanceIndex(args: {
  centroidHz: number;
  f0: number;
  presenceRatio: number;
}): number {
  const ratio = args.centroidHz / Math.max(60, args.f0);
  // razão típica varia de ~4 (voz escura) a ~14 (voz muito brilhante)
  const byRatio = clamp(
    (Math.log2(Math.max(ratio, 1)) - Math.log2(4)) / (Math.log2(14) - Math.log2(4)),
    0,
    1,
  );
  const byPresence = clamp(args.presenceRatio / 0.35, 0, 1);
  return Math.round(100 * clamp(0.55 * byRatio + 0.45 * byPresence, 0, 1));
}

/** Energia na faixa de presença relativa ao total (0,3–5 kHz). */
export function presenceRatio(spec: Spectrum): number {
  const total = bandEnergy(spec, 60, 6000);
  if (total <= 1e-12) return 0;
  return clamp(bandEnergy(spec, 2000, 4000) / total, 0, 1);
}

/**
 * Energia por banda (escala logarítmica) normalizada em 0..1.
 * Serve para desenhar o espectrograma do HUD — visual, não medida.
 */
export function bandLevels(spec: Spectrum, bands = 18, loHz = 80, hiHz = 8000): number[] {
  const out = new Array<number>(bands).fill(0);
  const nyquist = spec.fs / 2;
  const hi = Math.min(hiHz, nyquist - 100);
  const logLo = Math.log2(loHz);
  const logHi = Math.log2(hi);
  if (!(logHi > logLo) || bands <= 0) return out;

  const energies = new Array<number>(bands).fill(0);
  const counts = new Array<number>(bands).fill(0);
  for (let k = 1; k < spec.magnitude.length; k++) {
    const f = spec.freqs[k];
    if (f < loHz || f > hi) continue;
    const pos = (Math.log2(f) - logLo) / (logHi - logLo);
    const idx = Math.min(bands - 1, Math.max(0, Math.floor(pos * bands)));
    energies[idx] += spec.magnitude[k] * spec.magnitude[k];
    counts[idx] += 1;
  }

  let peak = 0;
  for (let i = 0; i < bands; i++) {
    const v = counts[i] > 0 ? Math.sqrt(energies[i] / counts[i]) : 0;
    out[i] = v;
    if (v > peak) peak = v;
  }
  if (peak <= 1e-12) return out.map(() => 0);

  // dB relativo ao pico do quadro, comprimido para 0..1 (−60 dB → 0)
  return out.map((v) => {
    const db = 20 * Math.log10(Math.max(v, 1e-12) / peak);
    return clamp((db + 60) / 60, 0, 1);
  });
}

export function tiltToBrightnessLabel(tilt: number): 'escura' | 'neutra' | 'brilhante' {
  if (tilt > -9) return 'brilhante';
  if (tilt < -16) return 'escura';
  return 'neutra';
}
