/**
 * Comparação antes/depois entre duas tomadas.
 * Produz deltas com direção de melhoria e um resumo em linguagem natural.
 */
import { ComparisonResult, MetricId, SessionMetrics } from '../../shared/types';
import { METRIC_LABEL, METRIC_UNIT, metricValue } from '../training/evaluate';
import { hzToSemitones } from '../utils/math';

const DIRECTION: Partial<Record<MetricId, 'up' | 'down' | 'either'>> = {
  f0Stability: 'up',
  levelStability: 'up',
  hnrDb: 'up',
  resonanceIndex: 'either',
  prosodySt: 'either',
  breathiness: 'down',
  clippingRatio: 'down',
  registerBreaks: 'down',
  levelSd: 'down',
  voicedRatio: 'up',
  f0MedianHz: 'either',
};

const COMPARE_METRICS: MetricId[] = [
  'f0MedianHz',
  'f0RangeSt',
  'f0Stability',
  'hnrDb',
  'resonanceIndex',
  'breathiness',
  'prosodySt',
  'levelStability',
  'formantF1Hz',
  'formantF2Hz',
];

export function compareSessions(a: SessionMetrics, b: SessionMetrics): ComparisonResult {
  const deltas = COMPARE_METRICS.map((metric) => {
    const va = metricValue(a, metric);
    const vb = metricValue(b, metric);
    const delta = va !== null && vb !== null ? Number((vb - va).toFixed(2)) : null;
    return {
      metric,
      label: METRIC_LABEL[metric],
      a: va,
      b: vb,
      delta,
      unit: METRIC_UNIT[metric],
      better: DIRECTION[metric] ?? 'either',
    };
  });

  const summary: string[] = [];
  const f0Delta = deltas.find((d) => d.metric === 'f0MedianHz')?.delta;
  if (f0Delta !== null && f0Delta !== undefined && Math.abs(f0Delta) >= 1) {
    const st = hzToSemitones(b.f0MedianHz ?? 1) - hzToSemitones(a.f0MedianHz ?? 1);
    summary.push(
      `${st > 0 ? 'Subiu' : 'Desceu'} ${Math.abs(st).toFixed(1)} semitons na altura mediana (${a.f0MedianHz?.toFixed(0) ?? '—'} → ${b.f0MedianHz?.toFixed(0) ?? '—'} Hz).`,
    );
  }
  const resDelta = deltas.find((d) => d.metric === 'resonanceIndex')?.delta;
  if (resDelta !== null && resDelta !== undefined && Math.abs(resDelta) >= 5) {
    summary.push(
      `Ressonância ${resDelta > 0 ? 'mais brilhante' : 'mais escura'} em ${Math.abs(Math.round(resDelta))} pontos (${a.resonanceIndex} → ${b.resonanceIndex}).`,
    );
  }
  const stabDelta = deltas.find((d) => d.metric === 'f0Stability')?.delta;
  if (stabDelta !== null && stabDelta !== undefined && Math.abs(stabDelta) >= 5) {
    summary.push(
      `Estabilidade de altura ${stabDelta > 0 ? 'melhorou' : 'piorou'} ${Math.abs(Math.round(stabDelta))} pontos.`,
    );
  }
  const hnrDelta = deltas.find((d) => d.metric === 'hnrDb')?.delta;
  if (hnrDelta !== null && hnrDelta !== undefined && Math.abs(hnrDelta) >= 2) {
    summary.push(
      `Clareza (HNR) ${hnrDelta > 0 ? 'aumentou' : 'diminuiu'} ${Math.abs(hnrDelta).toFixed(1)} dB.`,
    );
  }
  if (summary.length === 0) {
    summary.push(
      'As duas tomadas ficaram muito próximas nas métricas principais — tente comparar com mais tempo de prática entre elas.',
    );
  }
  return { a, b, deltas, summary };
}
