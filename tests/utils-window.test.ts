import { describe, expect, it } from 'vitest';
import {
  applyWindow,
  blackmanWindow,
  hammingWindow,
  hannWindow,
  preEmphasis,
} from '@core/dsp/window';
import {
  clamp,
  dbToLinear,
  ema,
  hzToMidi,
  hzToSemitones,
  lerp,
  linearToDb,
  mean,
  median,
  movingAverage,
  noteName,
  percentile,
  semitonesToHz,
  shortId,
  stdDev,
} from '@core/utils/math';

describe('janelas de análise', () => {
  const n = 64;

  it('hann começa e termina em zero e é simétrica', () => {
    const w = hannWindow(n);
    expect(w[0]).toBeCloseTo(0, 12);
    expect(w[n - 1]).toBeCloseTo(0, 12);
    expect(w[n >> 1]).toBeCloseTo(1, 2);
    for (let i = 0; i < n; i++) expect(w[i]).toBeCloseTo(w[n - 1 - i], 12);
  });

  it('hamming não zera nas pontas e tem centro ~1', () => {
    const w = hammingWindow(n);
    expect(w[0]).toBeCloseTo(0.08, 2);
    expect(w[n - 1]).toBeCloseTo(0.08, 2);
    expect(w[n >> 1]).toBeCloseTo(1, 2);
  });

  it('blackman decai mais que hann nas pontas (lóbulos laterais menores)', () => {
    const h = hannWindow(n);
    const b = blackmanWindow(n);
    expect(Math.abs(b[1])).toBeLessThan(Math.abs(h[1]));
    expect(b[n >> 1]).toBeCloseTo(1, 2);
  });

  it('applyWindow multiplica e trata índice fora do sinal como zero', () => {
    const x = new Float32Array([1, 1, 1, 1]);
    const w = new Float64Array([1, 0.5, 0.25, 0.125]);
    expect(Array.from(applyWindow(x, w))).toEqual([1, 0.5, 0.25, 0.125]);
    const curto = new Float32Array([1, 1]);
    expect(Array.from(applyWindow(curto, w))).toEqual([1, 0.5, 0, 0]);
    // deslocamento de leitura
    expect(Array.from(applyWindow(x, w, 2))).toEqual([1, 0.5, 0, 0]);
  });

  it('pré-ênfase preserva o primeiro ponto e atenua a componente contínua', () => {
    const x = new Float64Array([1, 1, 1, 1]);
    const y = preEmphasis(x, 0.97);
    expect(y[0]).toBe(1);
    expect(y[1]).toBeCloseTo(0.03, 12);
    expect(y[3]).toBeCloseTo(0.03, 12);
  });
});

describe('utilidades matemáticas', () => {
  it('clamp prende nos limites', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-5, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });

  it('média, mediana e desvio padrão', () => {
    expect(mean([])).toBe(0);
    expect(mean([1, 2, 3])).toBe(2);
    expect(median([])).toBe(0);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(stdDev([2])).toBe(0);
    expect(stdDev([2, 2, 2])).toBe(0);
    expect(stdDev([1, 3])).toBeCloseTo(Math.SQRT2, 12);
  });

  it('percentil interpola linearmente e satura em 0 e 100', () => {
    const xs = [10, 20, 30, 40];
    expect(percentile([], 50)).toBe(0);
    expect(percentile([7], 90)).toBe(7);
    expect(percentile(xs, 0)).toBe(10);
    expect(percentile(xs, 100)).toBe(40);
    expect(percentile(xs, 50)).toBe(25);
    expect(percentile(xs, 25)).toBeCloseTo(17.5, 12);
    expect(percentile(xs, -10)).toBe(10); // p fora da faixa é preso em 0
  });

  it('semitons e Hz são inversos; 0 Hz não tem semitom', () => {
    expect(hzToSemitones(0)).toBe(Number.NEGATIVE_INFINITY);
    const ref = 130.8127826502993;
    expect(hzToSemitones(ref)).toBeCloseTo(0, 10);
    const up = semitonesToHz(12);
    expect(hzToSemitones(up)).toBeCloseTo(12, 10);
  });

  it('nome de nota e MIDI', () => {
    expect(hzToMidi(440)).toBeCloseTo(69, 10);
    expect(noteName(440)).toBe('A4');
    expect(noteName(110)).toBe('A2');
    expect(noteName(0)).toBe('—');
    expect(noteName(Number.NaN)).toBe('—');
  });

  it('dB e linear são inversos, com piso em -120 dB', () => {
    expect(dbToLinear(0)).toBeCloseTo(1, 12);
    expect(linearToDb(1)).toBeCloseTo(0, 12);
    expect(linearToDb(0)).toBe(-120);
    expect(linearToDb(dbToLinear(-20))).toBeCloseTo(-20, 10);
  });

  it('lerp e ema', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    expect(ema(0, 10, 16, 0)).toBe(10); // tau zero = salta direto
    const meio = ema(0, 10, 50, 50);
    expect(meio).toBeGreaterThan(0);
    expect(meio).toBeLessThan(10);
    expect(ema(10, 10, 16, 50)).toBe(10);
  });

  it('média móvel mantém sinal constante e aceita janela inválida', () => {
    const consts = new Float32Array([2, 2, 2, 2]);
    expect(Array.from(movingAverage(consts, 1))).toEqual([2, 2, 2, 2]);
    const suave = movingAverage(consts, 3);
    for (const v of suave) expect(v).toBeCloseTo(2, 5);
    const rampa = movingAverage(new Float32Array([0, 0, 1, 1]), 2);
    expect(rampa.length).toBe(4);
    expect(rampa[3]).toBeGreaterThan(rampa[0]);
  });

  it('shortId é único o suficiente e usa o prefixo', () => {
    const a = shortId('r_');
    const b = shortId('r_');
    expect(a.startsWith('r_')).toBe(true);
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(3);
  });
});
