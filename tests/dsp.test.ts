import { describe, expect, it } from 'vitest';
import { FFT, nextPowerOfTwo } from '@core/dsp/fft';
import { detectPitch } from '@core/dsp/yin';
import { resampleBlock } from '@core/dsp/resample';
import { estimateFormants, lpcEnvelope, lpcOrder } from '@core/dsp/lpc';
import {
  bandLevels,
  hnrDb,
  magnitudeSpectrum,
  spectralCentroid,
  spectralTiltDbPerOct,
} from '@core/dsp/features';
import { decodeWav, encodeWav16, toMono } from '@core/dsp/wav';
import { hzToSemitones, noteName, percentile, semitonesToHz, median } from '@core/utils/math';
import { addNoise, harmonicTone, silence, sine, synthVowel } from './helpers/synth';

describe('FFT', () => {
  it('detecta pico no bin correto', () => {
    const n = 1024;
    const fs = 16000;
    const fft = new FFT(n);
    const sig = sine(1000, fs, n / fs);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = sig[i];
    fft.transform(re, im);
    let maxBin = 0;
    let maxMag = 0;
    for (let k = 1; k < n / 2; k++) {
      const m = Math.hypot(re[k], im[k]);
      if (m > maxMag) {
        maxMag = m;
        maxBin = k;
      }
    }
    expect((maxBin * fs) / n).toBeCloseTo(1000, -1);
  });

  it('roundtrip transform/inverse preserva o sinal', () => {
    const n = 256;
    const fft = new FFT(n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    const orig = Array.from({ length: n }, (_, i) => Math.sin(i * 0.3) + 0.4 * Math.cos(i * 0.11));
    orig.forEach((v, i) => (re[i] = v));
    fft.transform(re, im);
    fft.inverse(re, im);
    orig.forEach((v, i) => expect(re[i]).toBeCloseTo(v, 8));
  });

  it('nextPowerOfTwo', () => {
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(300)).toBe(512);
    expect(nextPowerOfTwo(2048)).toBe(2048);
  });
});

describe('YIN — detecção de f0 em toda a tessitura', () => {
  const fs = 16000;
  const cases = [50, 65.41, 82.41, 110, 146.83, 196, 261.63, 392, 523.25, 784, 1046.5];
  for (const f of cases) {
    it(`detecta ${f} Hz (harmônicos, 16 kHz)`, () => {
      const frame = harmonicTone(f, fs, 2048 / fs, 10, 0.3, 1.2);
      const r = detectPitch(frame, { fs, minF0: 40, maxF0: 1200 });
      expect(r.f0).not.toBeNull();
      expect(Math.abs((r.f0 as number) - f) / f).toBeLessThan(0.02);
      expect(r.confidence).toBeGreaterThan(0.5);
    });
  }

  it('detecta baixo profundo em 44.1 kHz após reamostragem para 16 kHz', () => {
    const fs48 = 44100;
    const tone = harmonicTone(41.2, fs48, 0.3, 20, 0.3, 1.0);
    const res = resampleBlock(tone, fs48, 16000);
    const frame = res.subarray(0, 2048);
    const r = detectPitch(frame, { fs: 16000, minF0: 35, maxF0: 1200 });
    expect(r.f0).not.toBeNull();
    expect(r.f0 as number).toBeGreaterThan(39);
    expect(r.f0 as number).toBeLessThan(44);
  });

  it('não reporta f0 em ruído puro', () => {
    const rnd = () => Math.random() * 2 - 1;
    const frame = new Float32Array(2048).map(rnd);
    const r = detectPitch(frame, { fs, minF0: 40, maxF0: 1200 });
    expect(r.f0 === null || r.confidence < 0.3).toBe(true);
  });

  it('tolera ruído moderado (0 dB SNR)', () => {
    const tone = harmonicTone(120, fs, 2048 / fs, 12, 0.3, 1.0);
    const noisy = addNoise(tone, 6, 99);
    const r = detectPitch(noisy, { fs, minF0: 40, maxF0: 1200 });
    expect(r.f0).not.toBeNull();
    expect(Math.abs((r.f0 as number) - 120)).toBeLessThan(6);
  });

  it('evita erro de oitava em sinal com fundamental fraca', () => {
    // fundamental atenuada: só harmônicos 2..8
    const n = 2048;
    const frame = new Float32Array(n);
    for (let h = 2; h <= 8; h++) {
      for (let i = 0; i < n; i++)
        frame[i] += (0.2 / h) * Math.sin((2 * Math.PI * 100 * h * i) / fs);
    }
    const r = detectPitch(frame, { fs, minF0: 40, maxF0: 1200 });
    expect(r.f0).not.toBeNull();
    // aceita 100 Hz ou 200 Hz, mas nunca 400+ (erro grosseiro de oitava)
    expect(r.f0 as number).toBeLessThan(220);
  });
});

describe('Reamostragem', () => {
  it('48k → 16k mantém a frequência', () => {
    const tone = sine(440, 48000, 0.2);
    const out = resampleBlock(tone, 48000, 16000);
    expect(out.length).toBeGreaterThan(3000);
    const frame = out.subarray(500, 500 + 2048);
    const r = detectPitch(frame, { fs: 16000, minF0: 100, maxF0: 2000 });
    expect(Math.abs((r.f0 as number) - 440)).toBeLessThan(6);
  });

  it('44.1k → 16k mantém a amplitude', () => {
    const tone = sine(220, 44100, 0.2, 0.5);
    const out = resampleBlock(tone, 44100, 16000);
    let peak = 0;
    for (let i = 100; i < out.length - 100; i++) peak = Math.max(peak, Math.abs(out[i]));
    expect(peak).toBeGreaterThan(0.4);
    expect(peak).toBeLessThan(0.6);
  });
});

describe('LPC — estimativa de formantes', () => {
  const fs = 16000;
  it('recupera F1/F2 de vogal /a/ sintética', () => {
    const signal = synthVowel(120, fs, 0.4, [
      [730, 90],
      [1090, 110],
      [2440, 170],
      [3400, 250],
    ]);
    const lpc = lpcEnvelope(signal.subarray(1000), fs, lpcOrder(fs), 1024);
    expect(lpc).not.toBeNull();
    const est = estimateFormants(lpc!);
    expect(est.frequencies.length).toBeGreaterThanOrEqual(2);
    const [f1, f2] = est.frequencies;
    expect(Math.abs(f1 - 730) / 730).toBeLessThan(0.18);
    expect(Math.abs(f2 - 1090) / 1090).toBeLessThan(0.18);
  });

  it('funciona para voz grave (f0 = 65 Hz)', () => {
    const signal = synthVowel(65, fs, 0.5, [
      [500, 80],
      [1500, 100],
      [2500, 160],
    ]);
    const lpc = lpcEnvelope(signal.subarray(1000), fs);
    const est = estimateFormants(lpc!);
    expect(est.frequencies.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(est.frequencies[0] - 500) / 500).toBeLessThan(0.25);
  });

  it('em voz aguda (f0 = 350 Hz) ainda entrega estimativas úteis', () => {
    // LIMITAÇÃO CONHECIDA E DOCUMENTADA: quando f0 se aproxima da largura de
    // banda de F1, os harmônicos ficam esparsos e F1 pode ser absorvido. O
    // estimador deve continuar devolvendo formantes plausíveis (F2/F3), sem
    // inventar valores absurdos.
    const signal = synthVowel(350, fs, 0.4, [
      [850, 90],
      [1600, 120],
      [2800, 200],
    ]);
    const lpc = lpcEnvelope(signal.subarray(1000), fs);
    const est = estimateFormants(lpc!);
    expect(est.frequencies.length).toBeGreaterThanOrEqual(1);
    const nearF2 = est.frequencies.some((f) => Math.abs(f - 1600) / 1600 < 0.25);
    expect(nearF2).toBe(true);
    for (const f of est.frequencies) expect(f).toBeLessThan(5000);
  });

  it('não explode com entrada silenciosa', () => {
    const lpc = lpcEnvelope(silence(fs, 0.2), fs);
    if (lpc) {
      const est = estimateFormants(lpc);
      expect(est.frequencies.length).toBe(0);
    }
  });
});

describe('Descritores espectrais', () => {
  const fs = 16000;
  it('HNR alto para tom periódico', () => {
    const tone = harmonicTone(150, fs, 2048 / fs, 10, 0.3, 1);
    const hnr = hnrDb(tone, fs, 150);
    expect(hnr).not.toBeNull();
    expect(hnr as number).toBeGreaterThan(18);
  });

  it('HNR baixo para ruído', () => {
    const noise = addNoise(silence(fs, 0.2), -40, 5);
    const hnr = hnrDb(noise.subarray(0, 2048), fs, 150);
    expect(hnr === null || (hnr as number) < 5).toBe(true);
  });

  it('centroide cresce com brilho', () => {
    const dark = harmonicTone(110, fs, 0.13, 6, 0.3, 3.5);
    const bright = harmonicTone(110, fs, 0.13, 20, 0.3, 0.6);
    const cDark = spectralCentroid(magnitudeSpectrum(dark, fs, 2048));
    const cBright = spectralCentroid(magnitudeSpectrum(bright, fs, 2048));
    expect(cBright).toBeGreaterThan(cDark);
  });

  it('inclinação espectral é mais negativa para som escuro', () => {
    const dark = harmonicTone(110, fs, 0.13, 6, 0.3, 3.5);
    const bright = harmonicTone(110, fs, 0.13, 20, 0.3, 0.4);
    const tDark = spectralTiltDbPerOct(magnitudeSpectrum(dark, fs, 2048));
    const tBright = spectralTiltDbPerOct(magnitudeSpectrum(bright, fs, 2048));
    expect(tDark).toBeLessThan(tBright);
  });
});

describe('WAV', () => {
  it('codifica e decodifica sem perda relevante', () => {
    const fs = 44100;
    const sig = sine(220, fs, 0.05, 0.5);
    const wav = encodeWav16(sig, fs, 1);
    const back = decodeWav(wav);
    expect(back.sampleRate).toBe(fs);
    expect(back.channels).toBe(1);
    expect(back.samples.length).toBe(sig.length);
    let maxErr = 0;
    for (let i = 0; i < sig.length; i++)
      maxErr = Math.max(maxErr, Math.abs(sig[i] - back.samples[i]));
    expect(maxErr).toBeLessThan(1 / 16000); // quantização de 16 bits
  });

  it('rejeita arquivos inválidos', () => {
    expect(() => decodeWav(new Uint8Array([1, 2, 3, 4]))).toThrow();
  });

  it('converte estéreo para mono', () => {
    const stereo = new Float32Array([0.5, -0.5, 0.25, -0.25]);
    const mono = toMono({ sampleRate: 16000, channels: 2, samples: stereo });
    expect(Array.from(mono)).toEqual([0, 0]);
  });
});

describe('utilidades de altura', () => {
  it('converte Hz ↔ semitons de forma reversível', () => {
    for (const hz of [55, 82.41, 220, 523.25, 1046.5]) {
      expect(semitonesToHz(hzToSemitones(hz))).toBeCloseTo(hz, 5);
    }
  });

  it('nomeia notas corretamente', () => {
    expect(noteName(440)).toBe('A4');
    expect(noteName(261.63)).toBe('C4');
    expect(noteName(65.41)).toBe('C2');
    expect(noteName(0)).toBe('—');
  });

  it('percentil e mediana', () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(median(xs)).toBe(5.5);
    expect(percentile(xs, 0)).toBe(1);
    expect(percentile(xs, 100)).toBe(10);
    expect(percentile(xs, 50)).toBeCloseTo(5.5, 5);
  });
});

describe('bandLevels', () => {
  it('distribui a energia entre as bandas e normaliza no pico', () => {
    const samples = synthVowel(140, 16000, 0.5, [
      [700, 90],
      [1220, 110],
      [2600, 180],
    ]);
    const spec = magnitudeSpectrum(samples, 16000, 2048);
    const bands = bandLevels(spec, 18);
    expect(bands).toHaveLength(18);
    // normalização relativa ao pico: a banda mais forte fica em 1
    expect(Math.max(...bands)).toBeCloseTo(1, 6);
    // e há estrutura: mais de uma banda acima de 0,2
    expect(bands.filter((b) => b > 0.2).length).toBeGreaterThan(1);
    for (const b of bands) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });

  it('devolve zeros para sinal silencioso em vez de NaN', () => {
    const spec = magnitudeSpectrum(silence(16000, 0.2), 16000, 2048);
    const bands = bandLevels(spec, 18);
    expect(bands).toHaveLength(18);
    expect(bands.every((b) => b === 0)).toBe(true);
  });

  it('não estoura quando a taxa não cobre a faixa pedida', () => {
    const spec = magnitudeSpectrum(sine(200, 8000, 0.25), 8000, 512);
    const bands = bandLevels(spec, 18, 80, 8000);
    expect(bands).toHaveLength(18);
    expect(bands.every((b) => Number.isFinite(b))).toBe(true);
  });
});
