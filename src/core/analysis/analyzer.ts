/**
 * Pipeline de análise: quadro → métricas → sessão.
 *
 * Fluxo:
 *   1. o áudio chega na taxa nativa do dispositivo (44.1/48 kHz);
 *   2. cada quadro é reamostrado para 16 kHz (suficiente para f0 e F1–F4,
 *      e 3× mais barato que analisar em 48 kHz);
 *   3. YIN → f0; LPC → formantes; espectro → centroide, inclinação, H1-H2;
 *   4. autocorrelação no período → HNR → índice de soprosidade;
 *   5. quadros são agregados em métricas de sessão por estatística robusta
 *      (medianas e percentis), resistente a falhas pontuais.
 */
import { FrameMetrics, QualityFlag, SessionMetrics } from '../../shared/types';
import { detectPitch } from '../dsp/yin';
import { formantsOf, lpcOrder } from '../dsp/lpc';
import {
  bandLevels,
  breathinessIndex,
  dbfs,
  h1h2Db,
  hnrDb,
  magnitudeSpectrum,
  presenceRatio,
  resonanceIndex,
  rms,
  spectralCentroid,
  spectralFlatness,
  spectralTiltDbPerOct,
} from '../dsp/features';
import { resampleBlock } from '../dsp/resample';
import { clamp, hzToSemitones, median, percentile, stdDev } from '../utils/math';

export const ANALYSIS_FS = 16000;
export const FRAME_LEN = 2048; // 128 ms @ 16 kHz
export const HOP_LEN = 256; // 16 ms @ 16 kHz

export interface AnalyzerOptions {
  /** Taxa nativa do stream. */
  fs: number;
  /** Offset de calibração dBFS→dB SPL (0 = não calibrado). */
  calibrationOffsetDb?: number;
  minF0?: number;
  maxF0?: number;
  /** Gate de silêncio em dBFS; abaixo disso o quadro não é analisado. */
  noiseGateDb?: number;
  /** Habilita suavização temporal de formantes. */
  smoothFormants?: boolean;
}

export interface FrameAnalysisContext {
  t: number;
  splOffsetDb: number;
  minF0: number;
  maxF0: number;
  lpcOrder: number;
  prevFormants: [number, number, number, number] | null;
}

const SILENCE_DB = -72;
const CLIP_THRESHOLD = 0.994;

/** Analisa um único quadro já reamostrado para `ANALYSIS_FS`. */
export function analyzeFrame(
  frame: Float32Array,
  fs: number,
  ctx: FrameAnalysisContext,
): FrameMetrics {
  const level = dbfs(rms(frame));
  let clipping = false;
  for (let i = 0; i < frame.length; i++) {
    if (Math.abs(frame[i]) >= CLIP_THRESHOLD) {
      clipping = true;
      break;
    }
  }

  const spec = magnitudeSpectrum(frame, fs, 2048);
  const centroidHz = spectralCentroid(spec);
  const tilt = spectralTiltDbPerOct(spec);
  const flatness = spectralFlatness(spec);

  const base: FrameMetrics = {
    t: ctx.t,
    f0: null,
    f0Confidence: 0,
    voiced: false,
    levelDb: level,
    splDb: ctx.splOffsetDb !== 0 ? level + ctx.splOffsetDb : null,
    hnrDb: null,
    formants: null,
    centroidHz,
    tiltDbPerOct: tilt,
    h1h2Db: null,
    breathiness: 0,
    resonanceIndex: 0,
    spectralFlatness: flatness,
    clipping,
    bands: bandLevels(spec, 18),
  };

  if (level < SILENCE_DB) return base;

  const pitch = detectPitch(frame, { fs, minF0: ctx.minF0, maxF0: ctx.maxF0 });
  if (!pitch.f0) {
    base.breathiness = clamp(
      breathinessIndex({ hnrDb: null, tiltDbPerOct: tilt, flatness, aperiodicity: 0.6 }),
      0,
      1,
    );
    return base;
  }

  const f0 = pitch.f0 as number;
  const hnr = hnrDb(frame, fs, f0);
  const h = h1h2Db(spec, f0);
  const pres = presenceRatio(spec);
  const breath = breathinessIndex({
    hnrDb: hnr,
    tiltDbPerOct: tilt,
    flatness,
    aperiodicity: pitch.aperiodicity,
  });

  let formants: [number, number, number, number] | null = null;
  if (pitch.confidence > 0.35) {
    const est = formantsOf(frame, fs, Math.min(5000, fs / 2 - 200));
    if (est.frequencies.length >= 2) {
      const cur = [
        est.frequencies[0],
        est.frequencies[1],
        est.frequencies[2] ?? null,
        est.frequencies[3] ?? null,
      ];
      if (ctx.prevFormants && est.confidence > 0.25) {
        // continuidade: rejeita saltos improváveis (ex.: troca de pico)
        for (let i = 0; i < 2; i++) {
          const prev = ctx.prevFormants[i];
          const now = cur[i] as number;
          if (prev > 0 && Math.abs(now - prev) > 420) cur[i] = prev;
        }
      }
      formants = [cur[0], cur[1], cur[2] ?? null, cur[3] ?? null] as [
        number,
        number,
        number,
        number,
      ];
    }
  }

  return {
    ...base,
    f0,
    f0Confidence: pitch.confidence,
    voiced: pitch.confidence > 0.2,
    hnrDb: hnr,
    formants,
    h1h2Db: h,
    breathiness: breath,
    resonanceIndex: resonanceIndex({ centroidHz, f0, presenceRatio: pres }),
  };
}

export interface AnalyzerResult {
  frames: FrameMetrics[];
}

/**
 * Analisador incremental usado em tempo real. Recebe blocos de qualquer
 * tamanho (128 amostras no AudioWorklet, ou arquivos inteiros) e emite
 * um `FrameMetrics` a cada 16 ms.
 */
export class VoiceAnalyzer {
  private readonly opts: Required<Pick<AnalyzerOptions, 'fs'>> & AnalyzerOptions;
  private buffer: Float32Array;
  private buffered = 0;
  private consumedSamples = 0;
  private prevFormants: [number, number, number, number] | null = null;
  private readonly ratio: number;
  private readonly frameNative: number;
  private readonly hopNative: number;
  private readonly lpcOrderValue: number;

  constructor(options: AnalyzerOptions) {
    this.opts = {
      calibrationOffsetDb: 0,
      minF0: 40,
      maxF0: 1200,
      smoothFormants: true,
      ...options,
      fs: options.fs,
    };
    this.ratio = options.fs / ANALYSIS_FS;
    this.frameNative = Math.ceil(FRAME_LEN * this.ratio);
    this.hopNative = Math.max(1, Math.round(HOP_LEN * this.ratio));
    this.lpcOrderValue = lpcOrder(ANALYSIS_FS);
    // Buffer de tamanho fixo: `push` consome no máximo o que falta para fechar
    // um quadro por iteração, então `buffered` nunca passa de `frameNative`.
    // Uma versão anterior crescia o buffer "sob demanda" com um teto de
    // segurança que nunca disparava — código morto que dava falsa sensação de
    // proteção (e um teste que jurava verificar memória sem verificar nada).
    this.buffer = new Float32Array(this.frameNative * 4);
  }

  reset(): void {
    this.buffered = 0;
    this.consumedSamples = 0;
    this.prevFormants = null;
  }

  /**
   * Atualiza o offset dBFS→dB SPL sem reiniciar a captura.
   *
   * Antes o offset só era lido no construtor: calibrar com o medidor rodando
   * não mudava o SPL exibido até parar e iniciar de novo — o usuário concluía
   * que a calibração não tinha sido salva.
   */
  setCalibrationOffset(db: number): void {
    const value = Number.isFinite(db) && db > 0 ? Math.min(120, db) : 0;
    this.opts.calibrationOffsetDb = value;
  }

  get calibrationOffsetDb(): number {
    return this.opts.calibrationOffsetDb ?? 0;
  }

  push(chunk: Float32Array): FrameMetrics[] {
    const out: FrameMetrics[] = [];
    let offset = 0;
    while (offset < chunk.length) {
      const need = this.frameNative - this.buffered;
      const take = Math.min(need, chunk.length - offset);
      this.buffer.set(chunk.subarray(offset, offset + take), this.buffered);
      this.buffered += take;
      offset += take;

      if (this.buffered >= this.frameNative) {
        const native = this.buffer.subarray(0, this.frameNative);
        const frame = resampleBlock(native, this.opts.fs, ANALYSIS_FS);
        const t = this.consumedSamples / this.opts.fs;
        const m = analyzeFrame(frame, ANALYSIS_FS, {
          t,
          splOffsetDb: this.opts.calibrationOffsetDb ?? 0,
          minF0: this.opts.minF0 ?? 40,
          maxF0: this.opts.maxF0 ?? 1200,
          lpcOrder: this.lpcOrderValue,
          prevFormants: this.prevFormants,
        });
        if (m.formants) this.prevFormants = m.formants;
        out.push(m);

        // desliza a janela pelo hop
        const remaining = this.buffered - this.hopNative;
        this.buffer.copyWithin(0, this.hopNative, this.buffered);
        this.buffered = Math.max(0, remaining);
        this.consumedSamples += this.hopNative;
      }
    }
    return out;
  }
}

/* ------------------------------------------------------------------ */
/* Agregação de sessão                                                */
/* ------------------------------------------------------------------ */

export interface SessionAnalysisOptions {
  /** Hz alvo do exercício (para desvio de afinação). */
  targetHz?: number | null;
  /** Duração declarada (para detectar amostras curtas). */
  expectedDurationSec?: number;
  /** Indica se o exercício é fala encadeada (muda rótulos e limites). */
  speech?: boolean;
  calibrationOffsetDb?: number;
}

export function aggregateFrames(
  frames: FrameMetrics[],
  durationSec: number,
  opts: SessionAnalysisOptions = {},
): SessionMetrics {
  const voicedFrames = frames.filter((f) => f.voiced && f.f0 && f.f0 > 0 && f.f0Confidence > 0.25);
  const f0s = voicedFrames.map((f) => f.f0 as number);
  const levels = frames.filter((f) => f.levelDb > SILENCE_DB).map((f) => f.levelDb);
  const voicedLevels = voicedFrames.map((f) => f.levelDb);
  const hnrs = voicedFrames.map((f) => f.hnrDb).filter((v): v is number => v !== null);
  const tilts = frames.map((f) => f.tiltDbPerOct).filter((v) => Number.isFinite(v));
  const breaths = frames.filter((f) => f.voiced).map((f) => f.breathiness);
  const resIdx = frames.filter((f) => f.voiced).map((f) => f.resonanceIndex);

  const f0St = f0s.map((f) => hzToSemitones(f));
  const f0Median = f0s.length ? median(f0s) : null;
  const voicedRatio = frames.length ? voicedFrames.length / frames.length : 0;

  // estabilidade: variação quadro-a-quadro dentro de trechos vozeados contíguos
  const deltas: number[] = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (a.voiced && b.voiced && a.f0 && b.f0) {
      deltas.push(Math.abs(hzToSemitones(b.f0) - hzToSemitones(a.f0)));
    }
  }
  const jitterIdx = deltas.length ? median(deltas) : 0;
  const f0Stability = Math.round(100 * clamp(1 - jitterIdx / 0.75, 0, 1));

  const levelMedian = levels.length ? median(levels) : null;
  const levelSd = voicedLevels.length > 1 ? stdDev(voicedLevels) : 0;
  const levelStability = Math.round(100 * clamp(1 - levelSd / 12, 0, 1));

  // descontinuidades de registro (saltos grandes entre quadros vozeados consecutivos)
  let registerBreaks = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (!a.f0 || !b.f0) continue;
    if (a.f0Confidence < 0.6 || b.f0Confidence < 0.6) continue;
    if (b.t - a.t > 0.2) continue;
    if (Math.abs(hzToSemitones(b.f0) - hzToSemitones(a.f0)) > 7) registerBreaks++;
  }

  const clippingFrames = frames.filter((f) => f.clipping).length;
  const clippingRatio = frames.length ? clippingFrames / frames.length : 0;

  const f1s = voicedFrames.map((f) => f.formants?.[0]).filter((v): v is number => !!v && v > 0);
  const f2s = voicedFrames.map((f) => f.formants?.[1]).filter((v): v is number => !!v && v > 0);

  const flatnessValues = frames.filter((f) => f.levelDb > -60).map((f) => f.spectralFlatness);
  const qualityFlags = computeQualityFlags({
    durationSec,
    voicedRatio,
    levelMedian,
    clippingRatio,
    levelSd,
    medianHnr: hnrs.length ? median(hnrs) : null,
    medianFlatness: flatnessValues.length ? median(flatnessValues) : 0,
    calibrationOffsetDb: opts.calibrationOffsetDb ?? 0,
  });

  const targetHz = opts.targetHz ?? null;
  const pitchDriftSt =
    targetHz && f0Median && f0Median > 0
      ? Number((hzToSemitones(f0Median) - hzToSemitones(targetHz)).toFixed(2))
      : null;

  const prosodySource = f0St.length ? f0St : [];
  const prosodySt =
    prosodySource.length > 3 ? percentile(prosodySource, 90) - percentile(prosodySource, 10) : 0;

  return {
    durationSec: Number(durationSec.toFixed(2)),
    voicedRatio: Number(voicedRatio.toFixed(3)),
    f0MedianHz: f0Median ? Math.round(f0Median * 10) / 10 : null,
    f0MeanHz: f0s.length
      ? Math.round((f0s.reduce((a, b) => a + b, 0) / f0s.length) * 10) / 10
      : null,
    f0P5Hz: f0s.length ? Math.round(percentile(f0s, 5)) : null,
    f0P95Hz: f0s.length ? Math.round(percentile(f0s, 95)) : null,
    f0MinHz: f0s.length ? Math.round(Math.min(...f0s)) : null,
    f0MaxHz: f0s.length ? Math.round(Math.max(...f0s)) : null,
    f0RangeSt: f0s.length > 2 ? Number((percentile(f0St, 95) - percentile(f0St, 5)).toFixed(2)) : 0,
    f0SdSt: f0St.length > 1 ? Number(stdDev(f0St).toFixed(2)) : 0,
    f0Stability,
    pitchDriftSt,
    levelMedianDb: levelMedian !== null ? Math.round(levelMedian * 10) / 10 : null,
    levelSdDb: Number(levelSd.toFixed(2)),
    levelStability,
    hnrMedianDb: hnrs.length ? Math.round(median(hnrs) * 10) / 10 : null,
    breathiness: breaths.length ? Number(median(breaths).toFixed(3)) : 0,
    brightness: Number(clamp((median(tilts) + 20) / 14, 0, 1).toFixed(3)),
    resonanceIndex: resIdx.length ? Math.round(median(resIdx)) : 0,
    tiltDbPerOct: tilts.length ? Number(median(tilts).toFixed(2)) : null,
    formantF1Hz: f1s.length ? Math.round(median(f1s)) : null,
    formantF2Hz: f2s.length ? Math.round(median(f2s)) : null,
    formantDispersionHz: f1s.length && f2s.length ? Math.round(median(f2s) - median(f1s)) : null,
    prosodySt: Number(prosodySt.toFixed(2)),
    clippingRatio: Number(clippingRatio.toFixed(4)),
    registerBreaks,
    frames: frames.length,
    qualityFlags,
  };
}

function computeQualityFlags(args: {
  durationSec: number;
  voicedRatio: number;
  levelMedian: number | null;
  clippingRatio: number;
  levelSd: number;
  medianHnr: number | null;
  medianFlatness: number;
  calibrationOffsetDb: number;
}): QualityFlag[] {
  const flags: QualityFlag[] = [];
  if (args.durationSec < 1.2) flags.push('amostra-curta');
  if (args.voicedRatio < 0.12) flags.push('pouco-sinal-voz');
  if (args.levelMedian !== null && args.levelMedian < -42) flags.push('sinal-baixo');
  if (args.clippingRatio > 0.002) flags.push('clipping');
  if (args.levelSd > 8) flags.push('nivel-inconsistente');
  if (args.calibrationOffsetDb === 0) flags.push('sem-calibracao');
  // Ruído: a planura espectral mediana é o indicador mais robusto de captura
  // ruidosa (ruído branco ≈ 0,5+; voz periódica < 0,2). HNR muito baixo reforça
  // o diagnóstico quando há voz detectada.
  const noisyByFlatness = args.medianFlatness > 0.35;
  const noisyByHnr = args.voicedRatio > 0.15 && args.medianHnr !== null && args.medianHnr < 6;
  if (noisyByFlatness || noisyByHnr) flags.push('ruido-alto');
  return flags;
}

/** Conveniência: analisa um buffer completo (arquivo ou gravação). */
export function analyzeAudio(
  samples: Float32Array,
  fs: number,
  opts: Omit<AnalyzerOptions, 'fs'> & SessionAnalysisOptions = {},
): { frames: FrameMetrics[]; metrics: SessionMetrics } {
  const analyzer = new VoiceAnalyzer({ fs, ...opts });
  const frames: FrameMetrics[] = [];
  const CHUNK = 4800;
  for (let i = 0; i < samples.length; i += CHUNK) {
    frames.push(...analyzer.push(samples.subarray(i, Math.min(i + CHUNK, samples.length))));
  }
  const duration = samples.length / fs;
  return { frames, metrics: aggregateFrames(frames, duration, opts) };
}
