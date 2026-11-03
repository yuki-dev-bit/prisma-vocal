/**
 * Detector de frequência fundamental (YIN) com função de diferença acelerada
 * por FFT — O(N log N) por quadro, viável em tempo real.
 *
 * Referência do algoritmo: de Cheveigné & Kawahara (2002), "YIN, a fundamental
 * frequency estimator for speech and music". JASA 111(4).
 *
 * Adaptações deste projeto:
 *  - correção de erro de oitava "para baixo" (subharmônicos) comum em vozes
 *    graves com fundamental fraca;
 *  - faixa de busca ampliável até 30 Hz para tessituras de baixo profundo;
 *  - devolve confiança contínua (1 - CMNDF) em vez de apenas sim/não.
 */
import { FFT, nextPowerOfTwo } from './fft';

export interface YinOptions {
  /** Taxa de amostragem do buffer. */
  fs: number;
  /** Menor f0 considerada (Hz). Padrão 40 Hz (cobre baixo profundo). */
  minF0?: number;
  /** Maior f0 considerada (Hz). Padrão 1200 Hz. */
  maxF0?: number;
  /** Limite absoluto do CMNDF para considerar vozeado. */
  threshold?: number;
  /** Limite acima do qual o quadro é declarado não vozeado. */
  unvoicedThreshold?: number;
}

export interface YinResult {
  /** f0 em Hz, ou null se não vozeado. */
  f0: number | null;
  /** Confiança 0..1 derivada do CMNDF. */
  confidence: number;
  /** Valor do CMNDF no período escolhido (menor = mais periódico). */
  aperiodicity: number;
}

const cache = new Map<number, { fft: FFT; re: Float64Array; im: Float64Array; ac: Float64Array }>();

function getScratch(fftSize: number) {
  let s = cache.get(fftSize);
  if (!s) {
    s = {
      fft: new FFT(fftSize),
      re: new Float64Array(fftSize),
      im: new Float64Array(fftSize),
      ac: new Float64Array(fftSize),
    };
    cache.set(fftSize, s);
  }
  return s;
}

/** Limpa buffers em cache (chamar ao trocar de dispositivo/taxa). */
export function clearYinCache(): void {
  cache.clear();
}

export function detectPitch(frame: Float32Array, opts: YinOptions): YinResult {
  const fs = opts.fs;
  const minF0 = opts.minF0 ?? 40;
  const maxF0 = opts.maxF0 ?? 1200;
  const threshold = opts.threshold ?? 0.15;
  const unvoicedThreshold = opts.unvoicedThreshold ?? 0.42;

  const n = frame.length;
  const W = n >> 1; // janela de integração (referência de YIN)
  if (W < 64) return { f0: null, confidence: 0, aperiodicity: 1 };

  let energy = 0;
  for (let i = 0; i < n; i++) energy += frame[i] * frame[i];
  if (energy / n < 1e-9) return { f0: null, confidence: 0, aperiodicity: 1 };

  const tauMin = Math.max(2, Math.floor(fs / maxF0));
  const tauMax = Math.min(W - 1, Math.ceil(fs / minF0));
  if (tauMax <= tauMin) return { f0: null, confidence: 0, aperiodicity: 1 };

  const fftSize = nextPowerOfTwo(n * 2);
  const { fft, re, im } = getScratch(fftSize);

  re.fill(0);
  im.fill(0);
  for (let i = 0; i < n; i++) re[i] = frame[i];
  fft.transform(re, im);
  for (let i = 0; i < fftSize; i++) {
    const p = re[i] * re[i] + im[i] * im[i];
    re[i] = p;
    im[i] = 0;
  }
  fft.inverse(re, im);

  // r[τ] = autocorrelação; prefixo de energia para Pτ
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const v = frame[i];
    prefix[i + 1] = prefix[i] + v * v;
  }

  /**
   * Função de diferença normalizada pela energia disponível em cada lag.
   *
   * d(τ) = Σ_{j=0}^{N-1-τ} (x[j] - x[j+τ])²  =  E0(τ) + E1(τ) - 2·r(τ)
   *
   * Normalizar por (E0+E1) é necessário porque o número de termos diminui
   * com τ; sem isso, a energia absoluta do quadro enviesa o resultado
   * (bug corrigido: a versão anterior comparava r(τ) de quadro inteiro com
   * energia de meia-janela, produzindo f0 ~10 % acima do real).
   */
  const d = new Float64Array(tauMax + 1);
  for (let tau = 0; tau <= tauMax; tau++) {
    const e0 = prefix[n - tau];
    const e1 = prefix[n] - prefix[tau];
    const den = e0 + e1;
    const raw = den - 2 * re[tau];
    d[tau] = den > 1e-12 ? Math.max(0, raw) / den : 1;
  }

  // CMNDF
  const cmnd = new Float64Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  // 1) primeiro mínimo local abaixo do limite
  let bestTau = -1;
  for (let tau = tauMin; tau <= tauMax - 1; tau++) {
    if (cmnd[tau] < threshold && cmnd[tau] <= cmnd[tau + 1]) {
      bestTau = tau;
      break;
    }
  }

  // 2) fallback: mínimo global
  if (bestTau < 0) {
    let minVal = Infinity;
    for (let tau = tauMin; tau <= tauMax - 1; tau++) {
      if (cmnd[tau] < minVal) {
        minVal = cmnd[tau];
        bestTau = tau;
      }
    }
    if (bestTau < 0 || minVal > unvoicedThreshold) {
      return {
        f0: null,
        confidence: 0,
        aperiodicity: Math.min(1, minVal === Infinity ? 1 : minVal),
      };
    }
  }

  /**
   * 3) Correção conservadora de subharmônico.
   *
   * Só age quando o dip encontrado é FRACO (cmnd > 0.10) e o dobro do período é
   * claramente mais periódico (< 50% do valor). Sem essa restrição, sinais
   * perfeitamente periódicos (dip ≈ 0) sofriam erro de oitava para baixo —
   * um senoide de 200 Hz era lido como 66,7 Hz.
   */
  const cmndBest = cmnd[bestTau];
  if (cmndBest > 0.1) {
    for (const k of [2, 3]) {
      const t = bestTau * k;
      if (t <= tauMax && fs / t >= minF0 * 0.95 && cmnd[t] < cmndBest * 0.5) bestTau = t;
    }
  }

  // 4) interpolação parabólica
  const ym1 = cmnd[Math.max(1, bestTau - 1)];
  const y0 = cmnd[bestTau];
  const yp1 = cmnd[Math.min(tauMax, bestTau + 1)];
  const denom = 2 * (2 * y0 - ym1 - yp1);
  const shift = denom !== 0 ? (yp1 - ym1) / denom : 0;
  const refinedTau = bestTau + Math.max(-0.5, Math.min(0.5, shift));

  const f0 = fs / refinedTau;
  if (!Number.isFinite(f0) || f0 < minF0 * 0.95 || f0 > maxF0 * 1.05) {
    return { f0: null, confidence: 0, aperiodicity: y0 };
  }
  const confidence = Math.max(0, Math.min(1, 1 - y0 / unvoicedThreshold));
  return { f0, confidence, aperiodicity: y0 };
}

/** Autocorrelação normalizada em um lag específico (usada para HNR). */
export function normalizedAutocorrAtLag(frame: Float32Array, lag: number): number {
  const n = frame.length;
  let num = 0;
  let e0 = 0;
  let e1 = 0;
  for (let i = 0; i + lag < n; i++) {
    num += frame[i] * frame[i + lag];
    e0 += frame[i] * frame[i];
    e1 += frame[i + lag] * frame[i + lag];
  }
  const den = Math.sqrt(e0 * e1);
  return den > 1e-12 ? num / den : 0;
}
