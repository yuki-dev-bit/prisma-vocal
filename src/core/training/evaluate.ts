/**
 * Resolução de metas e pontuação de exercícios.
 *
 * As metas do currículo são relativas (ex.: "+2 semitons sobre a sua linha de
 * base"). Este módulo converte essas metas em limites numéricos comparáveis
 * com as métricas medidas e calcula a nota ponderada.
 */
import { MetricId, MetricTarget, SessionMetrics } from '../../shared/types';
import { clamp } from '../utils/math';

export interface TargetContext {
  /** Mediana de f0 da linha de base do usuário (avaliação/vogal confortável). */
  baselineF0: number | null;
  /** Índice de ressonância da linha de base. */
  baselineBrightness: number | null;
  /** Extensão vocal auto-medida (semitons). */
  selfRangeSt: number | null;
}

export const EMPTY_CONTEXT: TargetContext = {
  baselineF0: null,
  baselineBrightness: null,
  selfRangeSt: null,
};

/** Valor de uma métrica em uma sessão, ou null quando não aplicável. */
export function metricValue(metrics: SessionMetrics, id: MetricId): number | null {
  switch (id) {
    case 'f0MedianHz':
      return metrics.f0MedianHz;
    case 'f0RangeSt':
      return metrics.f0RangeSt;
    case 'f0Stability':
      return metrics.f0Stability;
    case 'levelDb':
      return metrics.levelMedianDb;
    case 'levelSd':
      return metrics.levelSdDb;
    case 'levelStability':
      return metrics.levelStability;
    case 'hnrDb':
      return metrics.hnrMedianDb;
    case 'brightness':
      return metrics.brightness;
    case 'resonanceIndex':
      return metrics.resonanceIndex;
    case 'breathiness':
      return metrics.breathiness;
    case 'prosodySt':
      return metrics.prosodySt;
    case 'voicedRatio':
      return metrics.voicedRatio;
    case 'clippingRatio':
      return metrics.clippingRatio;
    case 'formantF1Hz':
      return metrics.formantF1Hz;
    case 'formantF2Hz':
      return metrics.formantF2Hz;
    case 'formantDispersionHz':
      return metrics.formantDispersionHz;
    case 'tiltDbPerOct':
      return metrics.tiltDbPerOct;
    case 'pitchDriftSt':
      return metrics.pitchDriftSt;
    case 'registerBreaks':
      return metrics.registerBreaks;
    default:
      return null;
  }
}

export const METRIC_LABEL: Record<MetricId, string> = {
  f0MedianHz: 'altura mediana',
  f0RangeSt: 'extensão usada',
  f0Stability: 'estabilidade de altura',
  levelDb: 'volume',
  levelSd: 'variação de volume',
  levelStability: 'estabilidade de volume',
  hnrDb: 'clareza (harmônico/ruído)',
  brightness: 'brilho',
  resonanceIndex: 'ressonância',
  breathiness: 'soprosidade',
  prosodySt: 'melodia de fala',
  voicedRatio: 'proporção de voz',
  clippingRatio: 'clipping',
  formantF1Hz: 'F1',
  formantF2Hz: 'F2',
  formantDispersionHz: 'dispersão de formantes',
  tiltDbPerOct: 'inclinação espectral',
  pitchDriftSt: 'desvio de afinação',
  registerBreaks: 'quebras de registro',
};

export const METRIC_UNIT: Record<MetricId, string> = {
  f0MedianHz: 'Hz',
  f0RangeSt: 'st',
  f0Stability: '/100',
  levelDb: 'dBFS',
  levelSd: 'dB',
  levelStability: '/100',
  hnrDb: 'dB',
  brightness: '0–1',
  resonanceIndex: '/100',
  breathiness: '0–1',
  prosodySt: 'st',
  voicedRatio: '0–1',
  clippingRatio: '0–1',
  formantF1Hz: 'Hz',
  formantF2Hz: 'Hz',
  formantDispersionHz: 'Hz',
  tiltDbPerOct: 'dB/8va',
  pitchDriftSt: 'st',
  registerBreaks: 'ocorrências',
};

export interface ResolvedTarget {
  target: MetricTarget;
  /** Limites resolvidos (inclusive). */
  min: number | null;
  max: number | null;
  /** Meta resolvida legível, ex.: "≥ 138 Hz". */
  display: string;
  /** Indica se a meta depende de uma linha de base ainda ausente. */
  unresolved: boolean;
}

export function resolveTarget(target: MetricTarget, ctx: TargetContext): ResolvedTarget {
  const unit = METRIC_UNIT[target.metric];
  const round = (v: number) => (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10);

  if (target.relative === 'baselineF0') {
    if (!ctx.baselineF0) {
      return {
        target,
        min: null,
        max: null,
        display: 'linha de base não medida',
        unresolved: true,
      };
    }
    const st = target.semitones ?? target.value ?? 0;
    const hz = ctx.baselineF0 * Math.pow(2, st / 12);
    return {
      target,
      min: target.op === '>=' ? hz : null,
      max: target.op === '<=' ? hz : null,
      display: `${target.op === '>=' ? '≥' : '≤'} ${round(hz)} Hz (${st > 0 ? '+' : ''}${st} st)`,
      unresolved: false,
    };
  }

  if (target.relative === 'baselineBrightness') {
    const base = ctx.baselineBrightness;
    if (base === null || base === undefined) {
      return {
        target,
        min: null,
        max: null,
        display: 'linha de base de ressonância não medida',
        unresolved: true,
      };
    }
    const delta = target.value ?? 0;
    return {
      target,
      min: base + Math.abs(delta),
      max: null,
      display: `≥ ${round(base + Math.abs(delta))}/100 (${delta >= 0 ? '+' : ''}${delta} sobre a base)`,
      unresolved: false,
    };
  }

  if (target.relative === 'selfRange') {
    if (!ctx.selfRangeSt) {
      return { target, min: null, max: null, display: 'extensão não medida', unresolved: true };
    }
    return {
      target,
      min: ctx.selfRangeSt,
      max: null,
      display: `≥ ${ctx.selfRangeSt} st`,
      unresolved: false,
    };
  }

  const v = target.value ?? 0;
  switch (target.op) {
    case 'entre':
      return {
        target,
        min: target.min ?? null,
        max: target.max ?? null,
        display: `entre ${target.min ?? '—'} e ${target.max ?? '—'} ${unit}`,
        unresolved: false,
      };
    case '>=':
      return { target, min: v, max: null, display: `≥ ${round(v)} ${unit}`, unresolved: false };
    case '<=':
      return { target, min: null, max: v, display: `≤ ${round(v)} ${unit}`, unresolved: false };
    case 'estavel':
      return { target, min: 60, max: null, display: `estável (≥ 60 ${unit})`, unresolved: false };
    default:
      return { target, min: null, max: null, display: '—', unresolved: true };
  }
}

export interface TargetOutcome {
  target: MetricTarget;
  met: boolean;
  actual: number | null;
  display: string;
  unresolved: boolean;
}

export function evaluateTargets(
  metrics: SessionMetrics,
  targets: MetricTarget[],
  ctx: TargetContext,
): TargetOutcome[] {
  return targets.map((target) => {
    const resolved = resolveTarget(target, ctx);
    const actual = metricValue(metrics, target.metric);
    if (resolved.unresolved || actual === null) {
      return { target, met: false, actual, display: resolved.display, unresolved: true };
    }
    const above = resolved.min === null || actual >= resolved.min - 1e-9;
    const below = resolved.max === null || actual <= resolved.max + 1e-9;
    return { target, met: above && below, actual, display: resolved.display, unresolved: false };
  });
}

/** Nota 0–100 ponderada. `null` quando não há metas resolvidas. */
export function scoreTargets(outcomes: TargetOutcome[]): number | null {
  const scored = outcomes.filter((o) => !o.unresolved);
  if (scored.length === 0) return null;
  let total = 0;
  let weight = 0;
  for (const o of scored) {
    const w = Math.max(0.1, o.target.weight);
    total += w * (o.met ? 1 : 0);
    weight += w;
  }
  return Math.round(clamp((total / weight) * 100, 0, 100));
}

/** Métricas que servem como linha de base a partir de uma sessão. */
export function contextFromMetrics(metrics: SessionMetrics | null): TargetContext {
  if (!metrics) return EMPTY_CONTEXT;
  return {
    baselineF0: metrics.f0MedianHz,
    baselineBrightness: metrics.resonanceIndex || null,
    selfRangeSt: metrics.f0RangeSt || null,
  };
}
