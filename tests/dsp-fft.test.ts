import { describe, expect, it } from 'vitest';
import { FFT, autocorrelation, nextPowerOfTwo } from '@core/dsp/fft';

describe('FFT', () => {
  it('recusa tamanhos que não são potência de dois', () => {
    expect(() => new FFT(3)).toThrow(/potência de dois/);
    expect(() => new FFT(1)).toThrow(/potência de dois/);
    expect(() => new FFT(0)).toThrow(/potência de dois/);
  });

  it('recusa buffers com tamanho incompatível', () => {
    const fft = new FFT(8);
    expect(() => fft.transform(new Float64Array(4), new Float64Array(4))).toThrow(/incompatível/);
  });

  it('acha o bin da senoide pura', () => {
    const n = 64;
    const fft = new FFT(n);
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = Math.sin((2 * Math.PI * 8 * i) / n);
    fft.transform(re, im);

    const mag = Array.from({ length: n / 2 }, (_, k) => Math.hypot(re[k], im[k]));
    const pico = mag.indexOf(Math.max(...mag));
    expect(pico).toBe(8);
    expect(mag[0]).toBeCloseTo(0, 9); // média nula
  });

  it('inverse desfaz a transformada', () => {
    const n = 16;
    const fft = new FFT(n);
    const original = Array.from({ length: n }, (_, i) => Math.cos(i) + 0.3 * i);
    const re = Float64Array.from(original);
    const im = new Float64Array(n);
    fft.transform(re, im);
    fft.inverse(re, im);
    for (let i = 0; i < n; i++) expect(re[i]).toBeCloseTo(original[i], 10);
  });

  it('transforma DC corretamente (soma das amostras no bin 0)', () => {
    const n = 8;
    const fft = new FFT(n);
    const re = Float64Array.from({ length: n }, () => 2);
    const im = new Float64Array(n);
    fft.transform(re, im);
    expect(re[0]).toBeCloseTo(16, 10);
    for (let k = 1; k < n; k++) expect(Math.hypot(re[k], im[k])).toBeCloseTo(0, 10);
  });
});

describe('nextPowerOfTwo', () => {
  it('sobe para a próxima potência de dois', () => {
    expect(nextPowerOfTwo(0)).toBe(1);
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(2)).toBe(2);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(1000)).toBe(1024);
    expect(nextPowerOfTwo(1024)).toBe(1024);
  });
});

describe('autocorrelation', () => {
  it('r[0] concentra a energia e o pico seguinte marca o período', () => {
    const n = 256;
    const periodo = 32;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = Math.sin((2 * Math.PI * i) / periodo);

    const r = autocorrelation(x, n);
    expect(r[0]).toBeGreaterThan(0);
    // primeiro máximo local depois do zero deve cair no período
    let melhor = 1;
    for (let lag = 1; lag < n / 2; lag++) if (r[lag] > r[melhor]) melhor = lag;
    expect(melhor).toBe(periodo);
    expect(r[periodo]).toBeGreaterThan(0.9 * r[0]);
  });

  it('preenche com zero até fftSize e respeita o buffer de saída', () => {
    const x = new Float32Array([1, 2, 3]);
    const out = new Float64Array(64);
    const r = autocorrelation(x, 64, out);
    expect(r).toBe(out);
    expect(r.length).toBe(64);
    expect(r[0]).toBeCloseTo(14, 9); // 1+4+9
  });

  it('sinal constante: correlação constante em todos os lags', () => {
    const x = new Float32Array(64).fill(1);
    const r = autocorrelation(x, 64);
    expect(r[0]).toBeCloseTo(64, 9);
    expect(r[10]).toBeCloseTo(64, 9);
  });
});
