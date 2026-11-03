import { describe, expect, it } from 'vitest';
import { generateFeedback } from '@core/feedback/engine';
import type { TargetOutcome } from '@core/training/evaluate';
import { METRIC_LABEL } from '@core/training/evaluate';
import type { MetricId, MetricTarget } from '@shared/types';
import { makeMetrics } from './helpers/metrics';

const ids = (ctx: Parameters<typeof generateFeedback>[0]) => generateFeedback(ctx).map((i) => i.id);

const target = (patch: Partial<MetricTarget> = {}): MetricTarget => ({
  metric: 'f0MedianHz',
  op: '>=',
  value: 140,
  weight: 1,
  label: 'altura mediana',
  ...patch,
});

const outcome = (patch: Partial<TargetOutcome> = {}): TargetOutcome => ({
  target: target(),
  met: false,
  actual: 130,
  display: '≥ 140 Hz',
  unresolved: false,
  ...patch,
});

describe('generateFeedback — qualidade de sinal', () => {
  it('sinal limpo não gera alerta de captura', () => {
    const itens = generateFeedback({ metrics: makeMetrics() });
    expect(itens.length).toBeGreaterThan(0);
    for (const id of ['clipping', 'sinal-baixo', 'ruido', 'pouca-voz']) {
      expect(itens.map((i) => i.id)).not.toContain(id);
    }
  });

  it('clipping aparece com severidade de atenção e o número real', () => {
    const [item] = generateFeedback({
      metrics: makeMetrics({ qualityFlags: ['clipping'], clippingRatio: 0.123 }),
    }).filter((i) => i.id === 'clipping');
    expect(item.severity).toBe('atencao');
    expect(item.what).toContain('12.3%');
    expect(item.evidence[0].value).toBe('12.3%');
  });

  it('sinal baixo reporta o nível mediano em dBFS', () => {
    const item = generateFeedback({
      metrics: makeMetrics({ qualityFlags: ['sinal-baixo'], levelMedianDb: -48 }),
    }).find((i) => i.id === 'sinal-baixo')!;
    expect(item.what).toContain('-48.0 dBFS');
    expect(item.how).toMatch(/ganho/i);
  });

  it('ruído e amostra curta entram com severidades próprias', () => {
    const ruido = generateFeedback({ metrics: makeMetrics({ qualityFlags: ['ruido-alto'] }) }).find(
      (i) => i.id === 'ruido',
    )!;
    expect(ruido.severity).toBe('dica');

    const curta = generateFeedback({
      metrics: makeMetrics({ qualityFlags: ['amostra-curta'], durationSec: 1.24 }),
    }).find((i) => i.id === 'amostra-curta')!;
    expect(curta.severity).toBe('info');
    expect(curta.what).toContain('1.2 s');
  });

  it('pouca voz só aparece quando a amostra não é curta', () => {
    expect(ids({ metrics: makeMetrics({ voicedRatio: 0.05 }) })).toContain('pouca-voz');
    expect(
      ids({ metrics: makeMetrics({ voicedRatio: 0.05, qualityFlags: ['amostra-curta'] }) }),
    ).not.toContain('pouca-voz');
  });
});

describe('generateFeedback — metas do exercício', () => {
  it('celebra quando todas as metas resolvidas foram cumpridas', () => {
    const item = generateFeedback({
      metrics: makeMetrics(),
      targets: [outcome({ met: true }), outcome({ met: true })],
    }).find((i) => i.id === 'metas-ok')!;
    expect(item.severity).toBe('sucesso');
    expect(item.evidence).toHaveLength(2);
  });

  it('meta não cumprida vira dica com alvo e medido', () => {
    const item = generateFeedback({ metrics: makeMetrics(), targets: [outcome()] }).find((i) =>
      i.id.startsWith('meta-f0MedianHz'),
    )!;
    expect(item.severity).toBe('dica');
    expect(item.what).toContain('≥ 140 Hz');
    expect(item.evidence.map((e) => e.label)).toEqual(['alvo', 'medido']);
  });

  it('meta pendente (sem linha de base) não vira cobrança', () => {
    const list = ids({
      metrics: makeMetrics(),
      targets: [outcome({ unresolved: true, actual: null })],
    });
    expect(list).not.toContain('metas-ok');
    expect(list.some((id) => id.startsWith('meta-'))).toBe(false);
  });

  it('metas parcialmente cumpridas: só as pendentes são cobradas', () => {
    const list = ids({
      metrics: makeMetrics(),
      targets: [outcome({ met: true }), outcome({ target: target({ metric: 'hnrDb' }) })],
    });
    expect(list).toContain('meta-hnrDb->=');
    expect(list).not.toContain('metas-ok');
  });
});

describe('generateFeedback — timbre e fonação', () => {
  it('compara a ressonância com a linha de base, para baixo e para cima', () => {
    expect(
      ids({
        metrics: makeMetrics({ resonanceIndex: 45 }),
        baseline: { f0: 130, brightness: 60 },
      }),
    ).toContain('brilho-baixo');
    expect(
      ids({
        metrics: makeMetrics({ resonanceIndex: 70 }),
        baseline: { f0: 130, brightness: 60 },
      }),
    ).toContain('brilho-alto');
  });

  it('sem linha de base não compara brilho', () => {
    const list = ids({ metrics: makeMetrics({ resonanceIndex: 10 }) });
    expect(list).not.toContain('brilho-baixo');
    expect(list).not.toContain('brilho-alto');
  });

  it('soprosidade alta e HNR baixo são diagnósticos diferentes', () => {
    expect(ids({ metrics: makeMetrics({ breathiness: 0.8 }) })).toContain('soprosidade');
    const hnr = ids({ metrics: makeMetrics({ hnrMedianDb: 6, breathiness: 0.2 }) });
    expect(hnr).toContain('hnr-baixo');
    expect(hnr).not.toContain('soprosidade');
    // com muita soprosidade, o HNR baixo é consequência, não um alerta duplicado
    expect(ids({ metrics: makeMetrics({ hnrMedianDb: 6, breathiness: 0.8 }) })).not.toContain(
      'hnr-baixo',
    );
  });

  it('estabilidade de altura baixa vira dica, mas só com voz suficiente', () => {
    expect(ids({ metrics: makeMetrics({ f0Stability: 40 }) })).toContain('estabilidade');
    expect(ids({ metrics: makeMetrics({ f0Stability: 40, voicedRatio: 0.1 }) })).not.toContain(
      'estabilidade',
    );
  });

  it('volume instável e volume alto são alertas distintos', () => {
    expect(ids({ metrics: makeMetrics({ levelStability: 40 }) })).toContain('volume-instavel');
    expect(ids({ metrics: makeMetrics({ levelMedianDb: -8 }) })).toContain('volume-alto');
    expect(ids({ metrics: makeMetrics({ levelMedianDb: null }) })).not.toContain('volume-alto');
  });

  it('quebras de registro aparecem a partir de três ocorrências', () => {
    expect(ids({ metrics: makeMetrics({ registerBreaks: 2 }) })).not.toContain('quebras-registro');
    expect(ids({ metrics: makeMetrics({ registerBreaks: 3 }) })).toContain('quebras-registro');
  });
});

describe('generateFeedback — prosódia', () => {
  it('só fala encadeada recebe dica de melodia', () => {
    const monotono = makeMetrics({ prosodySt: 1.5, f0RangeSt: 8 });
    expect(ids({ metrics: monotono, kind: 'leitura' })).toContain('prosodia-baixa');
    expect(ids({ metrics: monotono, kind: 'sustentado' })).not.toContain('prosodia-baixa');
  });

  it('elogia a prosódia quando a variação é boa', () => {
    expect(ids({ metrics: makeMetrics({ prosodySt: 7 }), kind: 'fala' })).toContain('prosodia-ok');
  });

  it('sem extensão medida não cobra prosódia', () => {
    expect(
      ids({ metrics: makeMetrics({ prosodySt: 1.5, f0RangeSt: 0 }), kind: 'livre' }),
    ).not.toContain('prosodia-baixa');
  });
});

describe('generateFeedback — fechamento', () => {
  it('cobra calibração quando o microfone nunca foi calibrado', () => {
    const item = generateFeedback({ metrics: makeMetrics(), calibration: false }).find(
      (i) => i.id === 'sem-calibracao',
    )!;
    expect(item.severity).toBe('info');
    expect(item.how).toMatch(/calibra/i);
    expect(ids({ metrics: makeMetrics(), calibration: true })).not.toContain('sem-calibracao');
  });

  it('fecha com próximo passo quando não há nada a corrigir', () => {
    const list = ids({ metrics: makeMetrics(), calibration: true });
    expect(list).toContain('proximo-passo');
  });

  it('nunca passa de 7 itens, priorizando os primeiros', () => {
    const itens = generateFeedback({
      metrics: makeMetrics({
        qualityFlags: ['clipping', 'sinal-baixo', 'ruido-alto', 'amostra-curta'],
        clippingRatio: 0.4,
        f0Stability: 30,
        levelStability: 30,
        levelMedianDb: -6,
        breathiness: 0.9,
        registerBreaks: 5,
        resonanceIndex: 10,
      }),
      baseline: { f0: 130, brightness: 70 },
      targets: [outcome(), outcome({ target: target({ metric: 'hnrDb' }) })],
      kind: 'fala',
      calibration: false,
    });
    expect(itens.length).toBeLessThanOrEqual(7);
    expect(itens[0].id).toBe('clipping'); // o mais grave primeiro
  });

  it('todo item responde o quê, por quê e como', () => {
    const itens = generateFeedback({
      metrics: makeMetrics({
        qualityFlags: ['clipping'],
        f0Stability: 30,
        breathiness: 0.9,
        registerBreaks: 4,
        levelMedianDb: -5,
      }),
      targets: [outcome()],
      kind: 'fala',
    });
    expect(itens.length).toBeGreaterThan(3);
    for (const item of itens) {
      expect(item.title.length).toBeGreaterThan(5);
      expect(item.what.length).toBeGreaterThan(5);
      expect(item.why.length).toBeGreaterThan(10);
      expect(item.how.length).toBeGreaterThan(10);
      expect(['atencao', 'dica', 'info', 'sucesso']).toContain(item.severity);
    }
  });

  it('nenhuma dica se apoia só na altura: as de f0 citam outro mecanismo', () => {
    const itens = generateFeedback({
      metrics: makeMetrics({ f0Stability: 30, f0RangeSt: 12, prosodySt: 1.2 }),
      kind: 'leitura',
    });
    for (const item of itens) {
      expect(item.why.length).toBeGreaterThan(10);
      expect(item.how.length).toBeGreaterThan(10);
    }
  });
});

describe('generateFeedback — explicação por métrica', () => {
  // Toda métrica pode aparecer como meta não cumprida; cada uma precisa de uma
  // explicação e de uma ação próprias — nada de texto genérico repetido.
  const metricas = Object.keys(METRIC_LABEL) as MetricId[];

  it('cada métrica não cumprida rende "por quê" e "como" específicos', () => {
    const vistos = new Map<string, string[]>();
    for (const metric of metricas) {
      const item = generateFeedback({
        metrics: makeMetrics({ f0MedianHz: null }),
        targets: [
          outcome({ target: target({ metric, op: '>=', value: 1e6, weight: 1, label: metric }) }),
        ],
        calibration: true,
      }).find((i) => i.id.startsWith(`meta-${metric}`));
      expect(item, metric).toBeDefined();
      expect(item!.why.length, metric).toBeGreaterThan(15);
      expect(item!.how.length, metric).toBeGreaterThan(15);
      expect(item!.evidence.length).toBe(2);
      vistos.set(metric, [item!.why, item!.how]);
    }
    // pelo menos 8 textos distintos: não é um único fallback copiado
    expect(new Set([...vistos.values()].map((v) => v.join('|'))).size).toBeGreaterThanOrEqual(8);
  });
});
