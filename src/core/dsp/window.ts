/** Janelas de análise e filtros auxiliares. */

export function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

export function hammingWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

export function blackmanWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  const a0 = 0.42,
    a1 = 0.5,
    a2 = 0.08;
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / (n - 1);
    w[i] = a0 - a1 * Math.cos(t) + a2 * Math.cos(2 * t);
  }
  return w;
}

/** Aplica janela in-place em uma cópia do sinal. */
export function applyWindow(x: Float32Array, w: Float64Array, from = 0): Float64Array {
  const n = w.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) out[i] = (x[from + i] ?? 0) * w[i];
  return out;
}

/** Pré-ênfase de 1ª ordem (destaca formantes para LPC). */
export function preEmphasis(x: Float64Array, alpha = 0.97): Float64Array {
  const out = new Float64Array(x.length);
  out[0] = x[0];
  for (let i = 1; i < x.length; i++) out[i] = x[i] - alpha * x[i - 1];
  return out;
}
