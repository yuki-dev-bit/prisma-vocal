/**
 * Análise LPC (predição linear) e estimativa de formantes por envelope.
 *
 * Método: autocorrelação + recursão de Levinson-Durbin, ordem proporcional à
 * taxa de amostragem (≈ fs/1000 + 4). O envelope é obtido avaliando o filtro
 * de síntese 1/A(z) no domínio da frequência e procurando máximos locais.
 *
 * LIMITAÇÃO CONHECIDA: formantes estimados por LPC são aproximações. Em vozes
 * muito graves e em vogais fechadas, F1 e H1 podem se confundir, e o LPC tende
 * a "puxar" a estimativa. Por isso a interface rotula essas medidas como
 * *estimativas* e exige que o usuário produza uma vogal estável para confiar
 * nelas. Isto não substitui análise de um fonoaudiólogo.
 */
import { FFT } from './fft';
import { hammingWindow, preEmphasis } from './window';

export function lpcOrder(fs: number): number {
  return Math.max(8, Math.min(24, Math.round(fs / 1000) + 4));
}

/**
 * Coeficientes LPC via recursão de Levinson-Durbin.
 *
 * Convenções (a fonte de bugs mais comum nesta parte):
 *   • coeficientes de PREDIÇÃO: x̂[n] = Σ p_j · x[n-j]
 *   • filtro de erro A(z) = 1 - Σ p_j·z^-j  (é o formato usado por LPC clássico)
 *
 * A função devolve A(z): A[0] = 1, A[j] = -p_j.
 * Misturar as duas convenções (subtrair em vez de somar na recursão) espelha
 * o espectro e destrói a estimativa de formantes — há teste cobrindo isso.
 */
export function levinsonDurbin(r: Float64Array, order: number): Float64Array {
  const p = new Float64Array(order + 1); // coeficientes de predição
  const tmp = new Float64Array(order + 1);
  let err = r[0];
  const A = new Float64Array(order + 1);
  A[0] = 1;
  if (!(err > 0)) return A;

  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc -= p[j] * r[i - j];
    let k = acc / err;
    if (!Number.isFinite(k)) break;
    // Quase singularidade (sinal quase periódico puro): truncar mantém o
    // filtro estável em vez de gerar coeficientes explosivos.
    if (k > 0.985) k = 0.985;
    if (k < -0.985) k = -0.985;
    tmp[i] = k;
    for (let j = 1; j < i; j++) tmp[j] = p[j] - k * p[i - j];
    for (let j = 1; j <= i; j++) p[j] = tmp[j];
    err *= 1 - k * k;
    if (err <= 1e-9 * r[0]) break;
  }
  for (let j = 1; j <= order; j++) A[j] = -p[j];
  return A;
}

export interface LpcFrame {
  coefficients: Float64Array;
  /** Envelope log-magnitude (dB) na grade de frequências. */
  envelope: Float64Array;
  /** Frequências correspondentes (Hz), passo = 8 Hz por padrão. */
  freqs: Float64Array;
}

export function lpcEnvelope(
  signal: Float32Array,
  fs: number,
  order = lpcOrder(fs),
  windowSize = 1024,
): LpcFrame | null {
  if (signal.length < windowSize) return null;
  const start = Math.max(0, (signal.length - windowSize) >> 1);
  const w = hammingWindow(windowSize);
  const x = new Float64Array(windowSize);
  for (let i = 0; i < windowSize; i++) x[i] = signal[start + i] * w[i];

  const pre = preEmphasis(x, 0.97);
  const r = new Float64Array(order + 1);
  for (let lag = 0; lag <= order; lag++) {
    let acc = 0;
    for (let i = lag; i < windowSize; i++) acc += pre[i] * pre[i - lag];
    r[lag] = acc;
  }
  if (r[0] <= 1e-12) return null;
  // Regularização numérica:
  //  (1) correção de ruído branco — evita polos sobre o círculo unitário;
  //  (2) janela de atraso gaussiana (~45 Hz) — estabiliza a recursão em
  //      sinais com forte dominância de graves (vozes de baixo).
  // Sem isso, a recursão de Levinson-Durbin degenera (coeficientes ~15) e o
  // envelope perde todos os formantes — verificado em testes.
  r[0] *= 1.0001;
  const lagWindowHz = 45;
  for (let lag = 1; lag <= order; lag++) {
    const t = (2 * Math.PI * lagWindowHz * lag) / fs;
    r[lag] *= Math.exp(-0.5 * t * t);
  }

  const a = levinsonDurbin(r, order);

  // pad fixo em 1024 (resolução de 15,6 Hz @ 16 kHz) é suficiente para F1–F4
  const pad = 1024;
  const re = new Float64Array(pad);
  const im = new Float64Array(pad);
  for (let i = 0; i <= order; i++) re[i] = a[i];
  const fft = new FFT(pad);
  fft.transform(re, im);

  const bins = pad >> 1;
  const freqs = new Float64Array(bins);
  const envelope = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    freqs[k] = (k * fs) / pad;
    const mag = Math.hypot(re[k], im[k]);
    envelope[k] = -20 * Math.log10(Math.max(mag, 1e-12));
  }
  return { coefficients: a, envelope, freqs };
}

export interface FormantEstimate {
  /** Frequências F1..Fn aceitas. */
  frequencies: number[];
  /** Larguras de banda aproximadas a -3 dB de cada formante. */
  bandwidths: number[];
  /** Confiança média (0..1). */
  confidence: number;
}

/**
 * Extrai máximos do envelope LPC com validação de largura de banda e
 * espaçamento mínimo entre formantes.
 */
export function estimateFormants(
  lpc: LpcFrame,
  opts: { maxFormants?: number; minHz?: number; maxHz?: number } = {},
): FormantEstimate {
  const maxFormants = opts.maxFormants ?? 4;
  const minHz = opts.minHz ?? 180;
  const maxHz = opts.maxHz ?? 5000;
  const env = lpc.envelope;
  const f = lpc.freqs;
  const candidates: { hz: number; bw: number; strength: number }[] = [];

  for (let k = 2; k < env.length - 2; k++) {
    const hz = f[k];
    if (hz < minHz || hz > maxHz) continue;
    if (!(env[k] > env[k - 1] && env[k] >= env[k + 1])) continue;
    if (!(env[k] > env[k - 2] && env[k] >= env[k + 2])) continue;

    // interpolação parabólica em log-magnitude
    const y1 = env[k - 1],
      y2 = env[k],
      y3 = env[k + 1];
    const denom = 2 * (2 * y2 - y1 - y3);
    const delta = denom !== 0 ? (y3 - y1) / denom : 0;
    const step = f[1] - f[0];
    const hzRef = hz + Math.max(-0.5, Math.min(0.5, delta)) * step;
    const peak = y2;
    // largura a -3 dB (procurando os dois lados)
    let left = k;
    while (left > 0 && env[left] > peak - 3) left--;
    let right = k;
    while (right < env.length - 1 && env[right] > peak - 3) right++;
    const bw = Math.max(step, (right - left) * step);
    candidates.push({ hz: hzRef, bw, strength: peak });
  }

  candidates.sort((a, b) => a.hz - b.hz);
  const accepted: { hz: number; bw: number }[] = [];
  for (const c of candidates) {
    if (c.bw > 700) continue; // pico largo demais: provavelmente inclinação espectral
    if (accepted.length > 0 && c.hz - accepted[accepted.length - 1].hz < 120) {
      // mantém o mais estreito (mais provável de ser ressonância real)
      const prev = accepted[accepted.length - 1];
      if (c.bw < prev.bw) accepted[accepted.length - 1] = c;
      continue;
    }
    accepted.push(c);
    if (accepted.length >= maxFormants) break;
  }

  if (accepted.length === 0) return { frequencies: [], bandwidths: [], confidence: 0 };
  const confidence = Math.max(
    0,
    Math.min(1, accepted.length / 3) *
      (1 - Math.min(1, accepted.reduce((s, a) => s + a.bw, 0) / (accepted.length * 900))),
  );
  return {
    frequencies: accepted.map((a) => Math.round(a.hz)),
    bandwidths: accepted.map((a) => Math.round(a.bw)),
    confidence,
  };
}

/** Atalho: formantes a partir de um quadro de áudio. */
export function formantsOf(signal: Float32Array, fs: number, maxHz = 5000): FormantEstimate {
  const lpc = lpcEnvelope(signal, fs);
  if (!lpc) return { frequencies: [], bandwidths: [], confidence: 0 };
  return estimateFormants(lpc, { maxHz });
}
