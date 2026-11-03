/**
 * Geradores de sinais sintéticos para testes determinísticos de DSP.
 * Nada aqui é usado em produção — apenas valida o pipeline.
 */

export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function sine(
  freq: number,
  fs: number,
  seconds: number,
  amp = 0.3,
  phase = 0,
): Float32Array {
  const n = Math.round(fs * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin(2 * Math.PI * freq * (i / fs) + phase);
  return out;
}

/** Onda com fundamental + harmônicos (fonte glotal aproximada). */
export function harmonicTone(
  f0: number,
  fs: number,
  seconds: number,
  harmonics = 12,
  amp = 0.25,
  rolloff = 1.0,
): Float32Array {
  const n = Math.round(fs * seconds);
  const out = new Float32Array(n);
  for (let h = 1; h <= harmonics; h++) {
    if (f0 * h > fs / 2 - 200) break;
    const a = amp / Math.pow(h, rolloff);
    const phase = (h * 0.37) % (2 * Math.PI);
    for (let i = 0; i < n; i++) {
      out[i] += a * Math.sin((2 * Math.PI * f0 * h * i) / fs + phase);
    }
  }
  return out;
}

export function addNoise(signal: Float32Array, snrDb: number, seed = 42, fs = 16000): Float32Array {
  const rnd = seededRandom(seed);
  let sigPow = 0;
  for (let i = 0; i < signal.length; i++) sigPow += signal[i] * signal[i];
  sigPow /= signal.length;
  const noisePow = sigPow / Math.pow(10, snrDb / 10);
  const noiseAmp = Math.sqrt(noisePow * 3); // ruído uniforme
  const out = new Float32Array(signal.length);
  const nyq = fs / 2;
  for (let i = 0; i < signal.length; i++) out[i] = signal[i] + (rnd() * 2 - 1) * noiseAmp;
  void nyq;
  return out;
}

/**
 * Vogal sintética via cascata de ressonadores de 2ª ordem (cada formante
 * com frequência e largura de banda), excitada por um trem de impulsos.
 */
export function synthVowel(
  f0: number,
  fs: number,
  seconds: number,
  formants: [number, number][],
  amp = 0.2,
  jitterSt = 0,
): Float32Array {
  const n = Math.round(fs * seconds);
  const source = new Float32Array(n);
  const rnd = seededRandom(7);
  let period = fs / f0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += 1;
    if (phase >= period) {
      phase = 0;
      source[i] = 1;
      // variação aleatória leve de período (jitter opcional)
      const jitterFactor = jitterSt === 0 ? 1 : Math.pow(2, ((rnd() * 2 - 1) * jitterSt) / 12);
      period = (fs / f0) * jitterFactor;
    }
  }
  // Radiação labial / inclinação glotal: derivada de 1ª ordem. Mantém o
  // espectro da fonte relativamente plano (condicionamento numérico saudável
  // para LPC), ao contrário de um integrador, que geraria quase-senoidal.
  const tilted = new Float32Array(n);
  tilted[0] = source[0];
  for (let i = 1; i < n; i++) tilted[i] = source[i] - 0.95 * source[i - 1];

  let signal: Float32Array = tilted;
  for (const [freq, bw] of formants) {
    signal = resonator(signal, fs, freq, bw);
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(signal[i]));
  const gain = peak > 0 ? amp / peak : 0;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = signal[i] * gain;
  return out;
}

/** Ressonador de 2ª ordem (biquad passa-banda ressonante). */
export function resonator(input: Float32Array, fs: number, freq: number, bw: number): Float32Array {
  const r = Math.exp((-Math.PI * bw) / fs);
  const theta = (2 * Math.PI * freq) / fs;
  const a1 = -2 * r * Math.cos(theta);
  const a2 = r * r;
  const gain = (1 - r) * Math.sqrt(1 - 2 * r * Math.cos(2 * theta) + r * r);
  const out = new Float32Array(input.length);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const y = gain * input[i] - a1 * y1 - a2 * y2;
    out[i] = y;
    y2 = y1;
    y1 = y;
  }
  return out;
}

export function silence(fs: number, seconds: number): Float32Array {
  return new Float32Array(Math.round(fs * seconds));
}

export function concat(...parts: Float32Array[]): Float32Array {
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
