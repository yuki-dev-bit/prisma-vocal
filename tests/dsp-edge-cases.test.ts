import { describe, expect, it } from 'vitest';
import {
  clearFeatureCache,
  magnitudeSpectrum,
  rms,
  tiltToBrightnessLabel,
  zeroCrossingRate,
} from '@core/dsp/features';
import { clearYinCache, detectPitch } from '@core/dsp/yin';
import { clearResampleCache, resampleBlock } from '@core/dsp/resample';
import { computeCalibrationOffset, MAX_CALIBRATION_OFFSET_DB } from '@core/audio/calibration';
import { VoiceAnalyzer, analyzeAudio } from '@core/analysis/analyzer';
import { compareSessions } from '@core/analysis/compare';
import { harmonicTone, sine } from './helpers/synth';
import { makeMetrics } from './helpers/metrics';

describe('zeroCrossingRate', () => {
  it('conta trocas de sinal', () => {
    expect(zeroCrossingRate(Float32Array.from([1, -1, 1, -1]))).toBe(1);
    expect(zeroCrossingRate(Float32Array.from([1, 1, 1]))).toBe(0);
  });

  it('sinal vazio ou de uma amostra devolve 0, sem dividir por zero', () => {
    expect(zeroCrossingRate(new Float32Array(0))).toBe(0);
    expect(zeroCrossingRate(Float32Array.from([0.5]))).toBe(0);
  });
});

describe('rms', () => {
  it('mede amplitude média e aceita janela parcial', () => {
    expect(rms(Float32Array.from([1, -1, 1, -1]))).toBeCloseTo(1, 6);
    expect(rms(new Float32Array(4))).toBe(0);
    expect(rms(Float32Array.from([1, 1, 0, 0]), 2, 4)).toBeCloseTo(0, 6);
  });
});

describe('cache de espectro', () => {
  it('limpar o cache não muda o resultado da análise', () => {
    const frame = sine(200, 48000, 0.01);
    const antes = magnitudeSpectrum(frame, 48000, 512);
    clearFeatureCache();
    const depois = magnitudeSpectrum(frame, 48000, 512);
    expect(Array.from(depois.magnitude)).toEqual(Array.from(antes.magnitude));
    expect(depois.binHz).toBeCloseTo(48000 / 512, 6);
  });
});

describe('cache do YIN', () => {
  it('limpar o cache mantém a detecção de altura', () => {
    const frame = harmonicTone(140, 48000, 1, 0.2, 0.4, 1);
    const opts = { fs: 48000, minF0: 60, maxF0: 500 };
    const antes = detectPitch(frame, opts);
    clearYinCache();
    const depois = detectPitch(frame, opts);
    expect(depois.f0).toBeCloseTo(antes.f0 as number, 6);
    expect(depois.confidence).toBeCloseTo(antes.confidence, 6);
  });
});

describe('tiltToBrightnessLabel', () => {
  it('classifica a inclinação espectral em três rótulos', () => {
    expect(tiltToBrightnessLabel(-6)).toBe('brilhante');
    expect(tiltToBrightnessLabel(-12)).toBe('neutra');
    expect(tiltToBrightnessLabel(-20)).toBe('escura');
  });
});

describe('resampleBlock', () => {
  it('mesma taxa devolve cópia, não o mesmo buffer', () => {
    const entrada = Float32Array.from([1, 2, 3]);
    const saida = resampleBlock(entrada, 48000, 48000);
    expect(Array.from(saida)).toEqual([1, 2, 3]);
    expect(saida).not.toBe(entrada);
  });

  it('entrada vazia devolve buffer vazio', () => {
    expect(resampleBlock(new Float32Array(0), 48000, 16000).length).toBe(0);
  });

  /**
   * O resample usa um banco de coeficientes por fase (bank polifásico). Se a
   * fase for indexada errado o sinal sai distorcido de forma sutil, que os
   * testes de frequência/amplitude não pegam. Aqui o resultado é comparado com
   * a implementação direta, sem banco, tap a tap.
   */
  it('bate com a convolução direta, sem banco de coeficientes', () => {
    const direto = (input: Float32Array, fsIn: number, fsOut: number, taps = 24) => {
      const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
      const blackman = (x: number) => {
        const t = (x + 1) * 0.5;
        return 0.42 - 0.5 * Math.cos(2 * Math.PI * t) + 0.08 * Math.cos(4 * Math.PI * t);
      };
      const ratio = fsIn / fsOut;
      const outLen = Math.floor(input.length / ratio);
      const out = new Float32Array(outLen);
      const cutoff = 0.5 * Math.min(1, fsOut / fsIn) * 0.94;
      const half = Math.floor(taps / 2);
      for (let n = 0; n < outLen; n++) {
        const t = n * ratio;
        const center = Math.floor(t);
        let acc = 0;
        let norm = 0;
        for (let k = -half + 1; k <= half; k++) {
          const idx = center + k;
          if (idx < 0 || idx >= input.length) continue;
          const d = t - idx;
          const coeff = 2 * cutoff * sinc(2 * cutoff * d) * blackman(d / half);
          acc += input[idx] * coeff;
          norm += coeff;
        }
        out[n] = norm !== 0 ? acc / norm : 0;
      }
      return out;
    };

    // 44,1 kHz é o caso com mais fases (160); 48 kHz tem fase única.
    for (const fsIn of [48000, 44100, 32000]) {
      const entrada = harmonicTone(180, fsIn, 0.4, 6, 0.3, 1);
      const esperado = direto(entrada, fsIn, 16000);
      const obtido = resampleBlock(entrada, fsIn, 16000);
      expect(obtido.length).toBe(esperado.length);
      let maiorErro = 0;
      for (let i = 0; i < esperado.length; i++) {
        maiorErro = Math.max(maiorErro, Math.abs(esperado[i] - obtido[i]));
      }
      // diferença só de arredondamento (ordem das multiplicações), < 1 ulp de float32
      expect(maiorErro).toBeLessThan(2e-7);
    }
  });

  it('resultado não depende do cache de coeficientes já estar quente', () => {
    const entrada = harmonicTone(200, 44100, 0.1, 4, 0.3, 1);
    const quente = resampleBlock(entrada, 44100, 16000);
    clearResampleCache();
    const frio = resampleBlock(entrada, 44100, 16000);
    expect(Array.from(frio)).toEqual(Array.from(quente));
  });

  it('aceita taxa não inteira (sem banco de fases) sem quebrar', () => {
    const entrada = sine(300, 44100, 0.1);
    const saida = resampleBlock(entrada, 44100.5, 16000);
    expect(saida.length).toBeGreaterThan(400);
    expect(saida.some((v) => v !== 0)).toBe(true);
  });

  it('preserva a duração ao converter 48 kHz → 16 kHz', () => {
    const entrada = harmonicTone(200, 48000, 1, 1, 0.3, 1);
    const saida = resampleBlock(entrada, 48000, 16000);
    expect(saida.length).toBeCloseTo(entrada.length / 3, -2);
    const { metrics } = analyzeAudio(saida, 16000);
    expect(Math.abs((metrics.f0MedianHz as number) - 200)).toBeLessThan(6);
  });
});

describe('computeCalibrationOffset', () => {
  it('calcula a diferença entre o SPL medido e o nível do microfone', () => {
    expect(computeCalibrationOffset(-40, 62)).toBe(102);
  });

  it('nunca devolve valor negativo nem acima do teto', () => {
    // medido abaixo do nível do microfone não faz sentido físico: fica em 0
    expect(computeCalibrationOffset(-10, -30)).toBe(0);
    expect(computeCalibrationOffset(-120, 90)).toBe(MAX_CALIBRATION_OFFSET_DB);
  });

  it('entrada inválida (NaN, Infinity) devolve 0 em vez de propagar erro', () => {
    expect(computeCalibrationOffset(Number.NaN, 62)).toBe(0);
    expect(computeCalibrationOffset(-40, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('arredonda para uma casa decimal', () => {
    expect(computeCalibrationOffset(-41.26, 62)).toBe(103.3);
  });
});

describe('VoiceAnalyzer — calibração e reinício', () => {
  it('aplica o offset de calibração sem reiniciar a captura', () => {
    const fs = 48000;
    const analyzer = new VoiceAnalyzer({ fs });
    expect(analyzer.calibrationOffsetDb).toBe(0);

    analyzer.setCalibrationOffset(100);
    expect(analyzer.calibrationOffsetDb).toBe(100);

    // valor absurdo é limitado a 120 dB e valor inválido zera
    analyzer.setCalibrationOffset(500);
    expect(analyzer.calibrationOffsetDb).toBe(120);
    analyzer.setCalibrationOffset(Number.NaN);
    expect(analyzer.calibrationOffsetDb).toBe(0);
    analyzer.setCalibrationOffset(-5);
    expect(analyzer.calibrationOffsetDb).toBe(0);
  });

  it('reset volta ao estado inicial e aceita nova captura', () => {
    const fs = 48000;
    const tome = harmonicTone(150, fs, 1, 0.4, 0.4, 1);
    const analyzer = new VoiceAnalyzer({ fs });
    const primeira = [] as ReturnType<VoiceAnalyzer['push']>;
    for (let i = 0; i + 128 <= tome.length; i += 128) {
      primeira.push(...analyzer.push(tome.subarray(i, i + 128)));
    }
    expect(primeira.length).toBeGreaterThan(10);

    analyzer.reset();
    const segunda = analyzer.push(tome.subarray(0, 128));
    expect(segunda.length).toBe(0); // buffer zerado: sem quadro completo ainda
  });

  it('agrega estatísticas coerentes de um tom estável', () => {
    const fs = 48000;
    const tone = harmonicTone(120, fs, 1, 2, 0.4, 1);
    const { metrics, frames } = analyzeAudio(tone, fs);
    expect(frames.length).toBeGreaterThan(10);
    expect(metrics.frames).toBe(frames.length);
    expect(metrics.voicedRatio).toBeGreaterThan(0.5);
  });
});

describe('compareSessions', () => {
  it('descreve melhora de HNR em dB quando a diferença é relevante', () => {
    const a = makeMetrics({ hnrMedianDb: 10 });
    const b = makeMetrics({ hnrMedianDb: 16 });
    const texto = compareSessions(a, b).summary.join(' ');
    expect(texto).toMatch(/Clareza \(HNR\) aumentou 6\.0 dB/);
  });

  it('descreve piora de HNR', () => {
    const texto = compareSessions(
      makeMetrics({ hnrMedianDb: 18 }),
      makeMetrics({ hnrMedianDb: 12 }),
    ).summary.join(' ');
    expect(texto).toMatch(/Clareza \(HNR\) diminuiu 6\.0 dB/);
  });

  it('variação pequena de HNR não vira comentário', () => {
    const texto = compareSessions(
      makeMetrics({ hnrMedianDb: 18 }),
      makeMetrics({ hnrMedianDb: 18.5 }),
    ).summary.join(' ');
    expect(texto).not.toMatch(/HNR/);
  });

  it('sessões idênticas não inventam mudança', () => {
    const iguais = makeMetrics();
    const { summary } = compareSessions(iguais, { ...iguais });
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.join(' ')).not.toMatch(/melhor|pior|aument|diminu/);
  });
});
