import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeWav } from '@core/dsp/wav';
import { analyzeAudio } from '@core/analysis/analyzer';
// O gerador é um script ESM em scripts/; importar direto mantém uma única fonte
// de verdade para o áudio sintético usado nas capturas de tela.
import { makeTestAudio } from '../scripts/make-test-audio.mjs';

describe('áudio de teste sintético', () => {
  it('produz degraus de altura detectáveis e métricas plausíveis', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'prisma-audio-'));
    try {
      const file = makeTestAudio(path.join(dir, 'voz-sintetica.wav'));
      const wav = decodeWav(readFileSync(file));
      expect(wav.sampleRate).toBe(48000);

      const { frames, metrics } = analyzeAudio(wav.samples, wav.sampleRate);
      expect(frames.length).toBeGreaterThan(300);
      expect(metrics.voicedRatio).toBeGreaterThan(0.8);
      // degraus em 118, 132, 138, 148 e 165 Hz
      expect(metrics.f0P5Hz).toBeGreaterThan(110);
      expect(metrics.f0P95Hz).toBeLessThan(175);
      expect(metrics.f0MedianHz).toBeGreaterThan(125);
      expect(metrics.f0MedianHz).toBeLessThan(150);
      expect(metrics.f0Stability).toBeGreaterThan(85);
      expect(metrics.resonanceIndex).toBeGreaterThan(20);
      expect(metrics.qualityFlags).not.toContain('clipping');
      expect(metrics.qualityFlags).not.toContain('ruido-alto');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
