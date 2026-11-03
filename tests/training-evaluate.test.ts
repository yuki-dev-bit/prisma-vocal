import { describe, expect, it } from 'vitest';
import {
  EMPTY_CONTEXT,
  METRIC_LABEL,
  METRIC_UNIT,
  contextFromMetrics,
  evaluateTargets,
  metricValue,
  resolveTarget,
  scoreTargets,
} from '@core/training/evaluate';
import type { MetricId, MetricTarget } from '@shared/types';
import { makeMetrics } from './helpers/metrics';

const target = (patch: Partial<MetricTarget> = {}): MetricTarget => ({
  metric: 'f0MedianHz',
  op: '>=',
  value: 140,
  weight: 1,
  label: 'centro acima de 140 Hz',
  ...patch,
});

const ctx = { baselineF0: 130, baselineBrightness: 45, selfRangeSt: 14 };

describe('metricValue', () => {
  const m = makeMetrics();

  it('mapeia cada métrica para o campo correspondente', () => {
    expect(metricValue(m, 'f0MedianHz')).toBe(130);
    expect(metricValue(m, 'f0RangeSt')).toBe(3.5);
    expect(metricValue(m, 'f0Stability')).toBe(78);
    expect(metricValue(m, 'levelDb')).toBe(-22);
    expect(metricValue(m, 'levelSd')).toBe(3);
    expect(metricValue(m, 'levelStability')).toBe(76);
    expect(metricValue(m, 'hnrDb')).toBe(18);
    expect(metricValue(m, 'brightness')).toBe(0.6);
    expect(metricValue(m, 'resonanceIndex')).toBe(45);
    expect(metricValue(m, 'breathiness')).toBe(0.25);
    expect(metricValue(m, 'prosodySt')).toBe(5);
    expect(metricValue(m, 'voicedRatio')).toBe(0.7);
    expect(metricValue(m, 'clippingRatio')).toBe(0);
    expect(metricValue(m, 'formantF1Hz')).toBe(620);
    expect(metricValue(m, 'formantF2Hz')).toBe(1500);
    expect(metricValue(m, 'formantDispersionHz')).toBe(880);
    expect(metricValue(m, 'tiltDbPerOct')).toBe(-12);
    expect(metricValue(m, 'registerBreaks')).toBe(0);
    expect(metricValue(m, 'clippingRatio')).toBe(0);
  });

  it('devolve null quando a métrica é nula ou não existe', () => {
    expect(metricValue(makeMetrics({ f0MedianHz: null }), 'f0MedianHz')).toBeNull();
    expect(metricValue(makeMetrics({ pitchDriftSt: null }), 'pitchDriftSt')).toBeNull();
  });

  it('tem rótulo e unidade para toda métrica', () => {
    const ids = Object.keys(METRIC_LABEL) as MetricId[];
    for (const id of ids) expect(METRIC_UNIT[id]).toBeTruthy();
  });
});

describe('resolveTarget', () => {
  it('meta absoluta ≥ 140 Hz vira um piso numérico', () => {
    const r = resolveTarget(target(), EMPTY_CONTEXT);
    expect(r).toMatchObject({ min: 140, max: null, unresolved: false, display: '≥ 140 Hz' });
  });

  it('meta absoluta ≤ usa teto', () => {
    const r = resolveTarget(target({ op: '<=', value: -18, metric: 'levelDb' }), EMPTY_CONTEXT);
    expect(r.max).toBe(-18);
    expect(r.display).toBe('≤ -18 dBFS');
  });

  it('meta "entre" usa os dois limites, inclusive quando faltam', () => {
    const r = resolveTarget(target({ op: 'entre', min: 120, max: 150 }), EMPTY_CONTEXT);
    expect(r).toMatchObject({ min: 120, max: 150, unresolved: false });
    expect(r.display).toBe('entre 120 e 150 Hz');
    const semLimites = resolveTarget(target({ op: 'entre' }), EMPTY_CONTEXT);
    expect(semLimites.display).toBe('entre — e — Hz');
  });

  it('meta "estavel" exige 60 na escala 0–100', () => {
    const r = resolveTarget(target({ op: 'estavel', metric: 'f0Stability' }), EMPTY_CONTEXT);
    expect(r.min).toBe(60);
    expect(r.display).toBe('estável (≥ 60 /100)');
  });

  it('meta relativa à linha de base converte semitons em Hz', () => {
    const r = resolveTarget(target({ relative: 'baselineF0', semitones: 2 }), ctx);
    expect(r.unresolved).toBe(false);
    expect(r.min).toBeCloseTo(130 * Math.pow(2, 2 / 12), 6);
    expect(r.display).toBe('≥ 146 Hz (+2 st)');
  });

  it('meta relativa sem linha de base fica pendente, não zerada', () => {
    const r = resolveTarget(target({ relative: 'baselineF0', semitones: 2 }), EMPTY_CONTEXT);
    expect(r).toMatchObject({ unresolved: true, min: null, max: null });
    expect(r.display).toMatch(/não medida/);
  });

  it('meta relativa ao brilho soma o delta absoluto à base', () => {
    const cima = resolveTarget(
      target({ relative: 'baselineBrightness', metric: 'resonanceIndex', value: 6 }),
      ctx,
    );
    expect(cima.min).toBe(51);
    expect(cima.display).toBe('≥ 51/100 (+6 sobre a base)');

    const baixo = resolveTarget(
      target({ relative: 'baselineBrightness', metric: 'resonanceIndex', value: -4 }),
      ctx,
    );
    expect(baixo.min).toBe(49);

    expect(
      resolveTarget(
        target({ relative: 'baselineBrightness', metric: 'resonanceIndex', value: 6 }),
        { ...ctx, baselineBrightness: null },
      ).unresolved,
    ).toBe(true);
  });

  it('meta de auto-extensão usa o valor medido e fica pendente sem ele', () => {
    const ok = resolveTarget(target({ relative: 'selfRange', metric: 'f0RangeSt' }), ctx);
    expect(ok.min).toBe(14);
    expect(ok.display).toBe('≥ 14 st');
    expect(
      resolveTarget(target({ relative: 'selfRange', metric: 'f0RangeSt' }), EMPTY_CONTEXT)
        .unresolved,
    ).toBe(true);
  });

  it('operação desconhecida é tratada como pendente', () => {
    const r = resolveTarget(target({ op: 'aprox' as MetricTarget['op'] }), EMPTY_CONTEXT);
    expect(r.unresolved).toBe(true);
    expect(r.display).toBe('—');
  });
});

describe('evaluateTargets', () => {
  it('compara com tolerância de 1e-9 na borda', () => {
    const m = makeMetrics({ f0MedianHz: 140 - 1e-12 });
    const [out] = evaluateTargets(m, [target()], EMPTY_CONTEXT);
    expect(out.met).toBe(true);
  });

  it('reprova quem fica abaixo do piso mesmo por pouco', () => {
    const [out] = evaluateTargets(makeMetrics({ f0MedianHz: 139.9 }), [target()], EMPTY_CONTEXT);
    expect(out).toMatchObject({ met: false, actual: 139.9, unresolved: false });
  });

  it('marca como pendente a métrica nula ou a meta sem base', () => {
    const [nula] = evaluateTargets(makeMetrics({ f0MedianHz: null }), [target()], EMPTY_CONTEXT);
    expect(nula).toMatchObject({ met: false, actual: null, unresolved: true });

    const [semBase] = evaluateTargets(
      makeMetrics(),
      [target({ relative: 'baselineF0', semitones: 2 })],
      EMPTY_CONTEXT,
    );
    expect(semBase.unresolved).toBe(true);
    expect(semBase.met).toBe(false);
  });

  it('mantém a ordem das metas pedidas', () => {
    const outs = evaluateTargets(
      makeMetrics(),
      [target({ metric: 'hnrDb', op: '>=', value: 15 }), target()],
      EMPTY_CONTEXT,
    );
    expect(outs.map((o) => o.target.metric)).toEqual(['hnrDb', 'f0MedianHz']);
  });
});

describe('scoreTargets', () => {
  const outcome = (met: boolean, weight = 1, unresolved = false) => {
    const r = resolveTarget(target(), EMPTY_CONTEXT);
    return {
      target: target({ weight }),
      met,
      actual: met ? 150 : 120,
      display: r.display,
      unresolved,
    };
  };

  it('sem metas resolvidas a nota é desconhecida (null)', () => {
    expect(scoreTargets([])).toBeNull();
    expect(scoreTargets([outcome(false, 1, true)])).toBeNull();
  });

  it('pondera pelo peso de cada meta', () => {
    expect(scoreTargets([outcome(true, 3), outcome(false, 1)])).toBe(75);
    expect(scoreTargets([outcome(true), outcome(true)])).toBe(100);
    expect(scoreTargets([outcome(false)])).toBe(0);
  });

  it('peso zero não vira divisor absurdo: usa o mínimo de 0,1', () => {
    expect(scoreTargets([outcome(true, 0), outcome(false, 1)])).toBe(9);
  });
});

describe('contextFromMetrics', () => {
  it('sem métricas o contexto fica vazio', () => {
    expect(contextFromMetrics(null)).toEqual(EMPTY_CONTEXT);
  });

  it('extrai f0, brilho e extensão, tratando zero como ausente', () => {
    expect(contextFromMetrics(makeMetrics())).toEqual({
      baselineF0: 130,
      baselineBrightness: 45,
      selfRangeSt: 3.5,
    });
    expect(contextFromMetrics(makeMetrics({ resonanceIndex: 0, f0RangeSt: 0 }))).toEqual({
      baselineF0: 130,
      baselineBrightness: null,
      selfRangeSt: null,
    });
  });
});

describe('metricValue — robustez', () => {
  it('métrica fora do catálogo devolve null em vez de quebrar', () => {
    expect(metricValue(makeMetrics(), 'naoExiste' as MetricId)).toBeNull();
  });
});
