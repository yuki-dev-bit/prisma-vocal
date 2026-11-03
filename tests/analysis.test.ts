import { describe, expect, it } from 'vitest';
import {
  VoiceAnalyzer,
  aggregateFrames,
  analyzeAudio,
  analyzeFrame,
} from '@core/analysis/analyzer';
import { addNoise, concat, harmonicTone, silence, sine, synthVowel } from './helpers/synth';

describe('VoiceAnalyzer — stream em tempo real', () => {
  const fs = 48000;

  it('detecta f0 de um tom estável em 48 kHz', () => {
    const tone = harmonicTone(110, fs, 2, 10, 0.3, 1);
    const { metrics } = analyzeAudio(tone, fs);
    expect(metrics.f0MedianHz).not.toBeNull();
    expect(Math.abs((metrics.f0MedianHz as number) - 110)).toBeLessThan(4);
    expect(metrics.voicedRatio).toBeGreaterThan(0.8);
    expect(metrics.f0Stability).toBeGreaterThan(60);
  });

  it('funciona com blocos de 128 amostras (tamanho do AudioWorklet)', () => {
    const tone = harmonicTone(220, fs, 1.5, 8, 0.3, 1);
    const analyzer = new VoiceAnalyzer({ fs });
    const frames = [];
    for (let i = 0; i + 128 <= tone.length; i += 128) {
      frames.push(...analyzer.push(tone.subarray(i, i + 128)));
    }
    expect(frames.length).toBeGreaterThan(60);
    const voiced = frames.filter((f) => f.voiced);
    expect(voiced.length).toBeGreaterThan(frames.length * 0.8);
    const median = voiced.map((f) => f.f0 as number).sort((a, b) => a - b)[
      Math.floor(voiced.length / 2)
    ];
    expect(Math.abs(median - 220)).toBeLessThan(8);
  });

  it('é invariante ao tamanho do bloco (mesma contagem de quadros)', () => {
    const tone = harmonicTone(150, fs, 1, 6, 0.3, 1);
    const whole = new VoiceAnalyzer({ fs });
    const a = whole.push(tone);
    const chunked = new VoiceAnalyzer({ fs });
    const b = [] as ReturnType<VoiceAnalyzer['push']>;
    for (let i = 0; i < tone.length; i += 997) b.push(...chunked.push(tone.subarray(i, i + 997)));
    expect(b.length).toBe(a.length);
  });

  it('detecta voz grave de baixo profundo (55 Hz) sem erro de oitava', () => {
    const tone = harmonicTone(55, fs, 2.5, 16, 0.3, 1.1);
    const { metrics } = analyzeAudio(tone, fs, { minF0: 30, maxF0: 1200 });
    expect(metrics.f0MedianHz).not.toBeNull();
    const hz = metrics.f0MedianHz as number;
    expect(hz).toBeGreaterThan(48);
    expect(hz).toBeLessThan(62);
  });

  it('detecta voz aguda (700 Hz)', () => {
    const tone = harmonicTone(700, fs, 2, 6, 0.3, 1);
    const { metrics } = analyzeAudio(tone, fs);
    expect(metrics.f0MedianHz).not.toBeNull();
    expect(Math.abs((metrics.f0MedianHz as number) - 700)).toBeLessThan(25);
  });

  it('não detecta voz em silêncio', () => {
    const { metrics } = analyzeAudio(silence(fs, 1), fs);
    expect(metrics.f0MedianHz).toBeNull();
    expect(metrics.voicedRatio).toBe(0);
    expect(metrics.qualityFlags).toContain('pouco-sinal-voz');
  });

  it('marca clipping quando o sinal satura', () => {
    const loud = harmonicTone(140, fs, 1.5, 10, 1.6, 1);
    for (let i = 0; i < loud.length; i++) loud[i] = Math.max(-1, Math.min(1, loud[i]));
    const { metrics } = analyzeAudio(loud, fs);
    expect(metrics.clippingRatio).toBeGreaterThan(0.5);
    expect(metrics.qualityFlags).toContain('clipping');
  });

  it('estabilidade cai com jitter de altura', () => {
    const steady = harmonicTone(150, fs, 2, 8, 0.3, 1);
    const shaky = new Float32Array(steady.length);
    // modulação de altura (vibrato lento e amplo)
    for (let i = 0; i < shaky.length; i++) {
      const t = i / fs;
      shaky[i] = 0.3 * Math.sin(2 * Math.PI * 150 * t * (1 + 0.06 * Math.sin(2 * Math.PI * 6 * t)));
    }
    const a = analyzeAudio(steady, fs).metrics;
    const b = analyzeAudio(shaky, fs).metrics;
    expect(b.f0Stability).toBeLessThanOrEqual(a.f0Stability);
  });

  it('agrega flags de qualidade em amostra curta e sem calibração', () => {
    const tone = harmonicTone(120, fs, 0.5, 6, 0.3, 1);
    const { metrics } = analyzeAudio(tone, fs);
    expect(metrics.qualityFlags).toContain('amostra-curta');
    expect(metrics.qualityFlags).toContain('sem-calibracao');
  });

  it('com calibração, devolve estimativa em dB SPL', () => {
    const tone = harmonicTone(120, fs, 1, 6, 0.3, 1);
    const analyzer = new VoiceAnalyzer({ fs, calibrationOffsetDb: 94 });
    const frames = analyzer.push(tone);
    const withSpl = frames.filter((f) => f.splDb !== null);
    expect(withSpl.length).toBeGreaterThan(0);
    expect(withSpl[0].splDb as number).toBeGreaterThan(30);
  });

  it('em fluxo contínuo, o buffer não acumula nem perde quadro', () => {
    // O buffer interno é de tamanho fixo (frameNative × 4) e `push` nunca pede
    // mais do que falta para fechar um quadro, então 2 s em blocos pequenos
    // precisam produzir exatamente os mesmos quadros da análise de uma vez.
    const audio = harmonicTone(110, fs, 2, 6, 0.2, 1);
    const blockSize = 1024;
    const analyzer = new VoiceAnalyzer({ fs });
    const streamed = [];
    for (let i = 0; i + blockSize <= audio.length; i += blockSize) {
      streamed.push(...analyzer.push(audio.subarray(i, i + blockSize)));
    }
    const whole = analyzeAudio(audio, fs).frames;

    expect(streamed.length).toBeGreaterThan(100);
    // mesma contagem, com tolerância de um quadro na borda do último pedaço
    expect(Math.abs(streamed.length - whole.length)).toBeLessThanOrEqual(1);
    const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    expect(median(streamed.filter((f) => f.voiced).map((f) => f.f0 as number))).toBeCloseTo(
      median(whole.filter((f) => f.voiced).map((f) => f.f0 as number)),
      0,
    );
  });

  it('extrai formantes coerentes de vogal sintética', () => {
    const vowel = synthVowel(110, fs, 2, [
      [700, 90],
      [1200, 110],
      [2500, 170],
    ]);
    const { metrics, frames } = analyzeAudio(vowel, fs);
    const withFormants = frames.filter((f) => f.formants);
    expect(withFormants.length).toBeGreaterThan(10);
    expect(metrics.formantF1Hz).not.toBeNull();
    expect(Math.abs((metrics.formantF1Hz as number) - 700) / 700).toBeLessThan(0.3);
  });

  it('detecta mudanças bruscas de registro', () => {
    const low = harmonicTone(100, fs, 0.8, 8, 0.3, 1);
    const high = harmonicTone(260, fs, 0.8, 8, 0.3, 1);
    const { metrics } = analyzeAudio(concat(low, high), fs);
    expect(metrics.registerBreaks).toBeGreaterThanOrEqual(1);
  });

  it('sinal com ruído alto recebe flag de ruído', () => {
    const tone = harmonicTone(120, fs, 2, 8, 0.05, 1);
    const noisy = addNoise(tone, -6, 3, fs);
    const { metrics } = analyzeAudio(noisy, fs);
    expect(metrics.qualityFlags).toContain('ruido-alto');
  });
});

describe('analyzeFrame', () => {
  it('devolve métricas coerentes para um quadro tonal', () => {
    const fs = 16000;
    const frame = sine(200, fs, 2048 / fs, 0.4);
    const m = analyzeFrame(frame, fs, {
      t: 0,
      splOffsetDb: 0,
      minF0: 40,
      maxF0: 1200,
      lpcOrder: 20,
      prevFormants: null,
    });
    expect(m.f0).toBeCloseTo(200, -1);
    expect(m.voiced).toBe(true);
    expect(m.levelDb).toBeLessThan(0);
    expect(m.levelDb).toBeGreaterThan(-40);
    expect(m.splDb).toBeNull();
    expect(m.resonanceIndex).toBeGreaterThanOrEqual(0);
    expect(m.resonanceIndex).toBeLessThanOrEqual(100);
  });

  it('marca quadro silencioso como não vozeado', () => {
    const fs = 16000;
    const frame = new Float32Array(2048);
    const m = analyzeFrame(frame, fs, {
      t: 0,
      splOffsetDb: 0,
      minF0: 40,
      maxF0: 1200,
      lpcOrder: 20,
      prevFormants: null,
    });
    expect(m.voiced).toBe(false);
    expect(m.f0).toBeNull();
  });
});

describe('aggregateFrames', () => {
  it('lida com lista vazia sem quebrar', () => {
    const m = aggregateFrames([], 0);
    expect(m.frames).toBe(0);
    expect(m.f0MedianHz).toBeNull();
    expect(m.qualityFlags).toContain('pouco-sinal-voz');
  });

  it('calcula desvio de afinação quando há alvo', () => {
    const fs = 48000;
    const tone = harmonicTone(220, fs, 1.5, 8, 0.3, 1);
    const { metrics } = analyzeAudio(tone, fs, { targetHz: 246.94 });
    expect(metrics.pitchDriftSt).not.toBeNull();
    expect(metrics.pitchDriftSt as number).toBeLessThan(-1.5);
  });
});
