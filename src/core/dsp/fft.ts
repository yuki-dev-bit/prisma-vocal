/**
 * FFT radix-2 iterativa com tabelas pré-computadas.
 *
 * Usada para: autocorrelação rápida (YIN), espectro de magnitude,
 * estimativa de centroide/inclinação espectral e envelope LPC.
 * Buffers são reutilizados (sem alocação por quadro) para evitar pressão
 * no coletor de lixo durante análise em tempo real.
 */
export class FFT {
  readonly size: number;
  private readonly cosTable: Float64Array;
  private readonly sinTable: Float64Array;
  private readonly reverse: Uint32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT exige potência de dois, recebido: ${size}`);
    }
    this.size = size;
    const half = size >> 1;
    this.cosTable = new Float64Array(half);
    this.sinTable = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      this.cosTable[i] = Math.cos((-2 * Math.PI * i) / size);
      this.sinTable[i] = Math.sin((-2 * Math.PI * i) / size);
    }
    this.reverse = new Uint32Array(size);
    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let rev = 0;
      for (let b = 0; b < bits; b++) rev |= ((i >>> b) & 1) << (bits - 1 - b);
      this.reverse[i] = rev;
    }
  }

  /** Transformada in-place em buffers separados de parte real/imaginária. */
  transform(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    if (re.length !== n || im.length !== n)
      throw new Error('Tamanho de buffer incompatível com FFT');
    for (let i = 0; i < n; i++) {
      const j = this.reverse[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < half; k++) {
          const tw = k * step;
          const c = this.cosTable[tw];
          const s = this.sinTable[tw];
          const a = i + k;
          const b = a + half;
          const xr = re[b] * c - im[b] * s;
          const xi = re[b] * s + im[b] * c;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
  }

  /** Transformada inversa in-place (com divisão por N). */
  inverse(re: Float64Array, im: Float64Array): void {
    const n = this.size;
    for (let i = 0; i < n; i++) im[i] = -im[i];
    this.transform(re, im);
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] = -im[i] / n;
    }
  }
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Autocorrelação via Wiener–Khinchin: r[τ] = IFFT(|FFT(x)|²).
 * `x` é preenchido com zeros até `fftSize`.
 */
export function autocorrelation(
  x: Float32Array,
  fftSize: number,
  out?: Float64Array,
): Float64Array {
  const n = fftSize;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const limit = Math.min(x.length, n);
  for (let i = 0; i < limit; i++) re[i] = x[i];
  const fft = new FFT(n);
  fft.transform(re, im);
  for (let i = 0; i < n; i++) {
    const p = re[i] * re[i] + im[i] * im[i];
    re[i] = p;
    im[i] = 0;
  }
  fft.inverse(re, im);
  const r = out ?? new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = re[i];
  return r;
}
