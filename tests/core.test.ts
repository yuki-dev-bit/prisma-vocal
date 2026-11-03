import { describe, expect, it } from 'vitest';
import {
  EXERCISE_INDEX,
  READING_PASSAGES,
  TRAINING_MODULES,
  lessonById,
  modulesForMode,
} from '@core/training/curriculum';
import {
  contextFromMetrics,
  evaluateTargets,
  resolveTarget,
  scoreTargets,
  EMPTY_CONTEXT,
} from '@core/training/evaluate';
import { recommendNext, nextInOrder, moduleSummary } from '@core/training/recommender';
import {
  computeStreak,
  emptyProgress,
  markLessonComplete,
  moduleCompletion,
  overallCompletion,
} from '@core/training/progress';
import {
  buildProfile,
  describeRange,
  suggestGoals,
  ASSESSMENT_PROTOCOL,
} from '@core/assessment/profile';
import { generateFeedback } from '@core/feedback/engine';
import { compareSessions } from '@core/analysis/compare';
import type { AssessmentStepResult, SessionRecord } from '@shared/types';
import { makeMetrics, makeProfile } from './helpers/metrics';

describe('currículo', () => {
  it('tem ids únicos e referências válidas', () => {
    const lessonIds = new Set<string>();
    const exerciseIds = new Set<string>();
    for (const m of TRAINING_MODULES) {
      expect(m.lessons.length).toBeGreaterThan(0);
      for (const l of m.lessons) {
        expect(lessonIds.has(l.id)).toBe(false);
        lessonIds.add(l.id);
        expect(l.moduleId).toBe(m.id);
        expect(m.mode === 'shared' || l.mode === m.mode).toBe(true);
        for (const e of l.exercises) {
          expect(exerciseIds.has(e.id)).toBe(false);
          exerciseIds.add(e.id);
          expect(e.steps.length).toBeGreaterThan(0);
          expect(e.durationSec).toBeGreaterThan(0);
        }
      }
    }
    expect(EXERCISE_INDEX.size).toBeGreaterThan(20);
    expect(READING_PASSAGES.length).toBeGreaterThan(2);
  });

  it('inclui todas as trilhas e não usa texto que julgue vozes', () => {
    const text = JSON.stringify(TRAINING_MODULES).toLowerCase();
    for (const forbidden of ['voz errada', 'voz feia', 'inferior', 'anormal', 'defeito']) {
      expect(text.includes(forbidden)).toBe(false);
    }
    expect(modulesForMode('mtf').some((m) => m.id === 'mtf-base')).toBe(true);
    expect(modulesForMode('ftm').some((m) => m.id === 'ftm-peso')).toBe(true);
    expect(modulesForMode('shared').every((m) => m.mode === 'shared')).toBe(true);
    expect(lessonById('fund-respiracao')).not.toBeNull();
    expect(lessonById('inexistente')).toBeNull();
  });
});

describe('metas relativas', () => {
  it('resolve meta de +2 semitons sobre a linha de base', () => {
    const resolved = resolveTarget(
      {
        metric: 'f0MedianHz',
        op: '>=',
        label: 'x',
        weight: 1,
        relative: 'baselineF0',
        semitones: 2,
      },
      { baselineF0: 110, baselineBrightness: 50, selfRangeSt: 20 },
    );
    expect(resolved.unresolved).toBe(false);
    expect(resolved.min).toBeCloseTo(110 * Math.pow(2, 2 / 12), 3);
  });

  it('marca meta como não resolvida sem linha de base', () => {
    const resolved = resolveTarget(
      {
        metric: 'f0MedianHz',
        op: '>=',
        label: 'x',
        weight: 1,
        relative: 'baselineF0',
        semitones: 2,
      },
      EMPTY_CONTEXT,
    );
    expect(resolved.unresolved).toBe(true);
  });

  it('avalia metas e calcula nota ponderada', () => {
    const metrics = makeMetrics({ f0MedianHz: 130, f0Stability: 80 });
    const outcomes = evaluateTargets(
      metrics,
      [
        {
          metric: 'f0MedianHz',
          op: '>=',
          label: 'altura',
          weight: 2,
          relative: 'baselineF0',
          semitones: 1,
        },
        { metric: 'f0Stability', op: '>=', label: 'estabilidade', weight: 1, value: 90 },
      ],
      { baselineF0: 120, baselineBrightness: 40, selfRangeSt: 20 },
    );
    expect(outcomes[0].met).toBe(true); // 130 >= 127.2
    expect(outcomes[1].met).toBe(false); // 80 < 90
    expect(scoreTargets(outcomes)).toBe(67); // (2*1 + 1*0)/3
  });

  it('nota é null quando não há metas resolvidas', () => {
    expect(scoreTargets([])).toBeNull();
    expect(
      scoreTargets(
        evaluateTargets(
          makeMetrics(),
          [
            {
              metric: 'f0MedianHz',
              op: '>=',
              label: 'x',
              weight: 1,
              relative: 'baselineF0',
              semitones: 2,
            },
          ],
          EMPTY_CONTEXT,
        ),
      ),
    ).toBeNull();
  });

  it('contexto a partir de métricas', () => {
    const ctx = contextFromMetrics(
      makeMetrics({ f0MedianHz: 98, resonanceIndex: 33, f0RangeSt: 12 }),
    );
    expect(ctx.baselineF0).toBe(98);
    expect(ctx.baselineBrightness).toBe(33);
    expect(ctx.selfRangeSt).toBe(12);
  });
});

describe('recomendação', () => {
  it('sem perfil, sugere avaliação e só aulas de fundamentos', () => {
    const rec = recommendNext({
      progress: emptyProgress(),
      mode: 'mtf',
      profile: null,
      sessions: [],
    });
    expect(rec).not.toBeNull();
    expect(rec!.needsAssessment).toBe(true);
    expect(rec!.moduleId).toBe('fundamentos');
  });

  it('com perfil, recomenda aula ligada a dificuldade medida', () => {
    const profile = makeProfile({
      challenges: ['Entonação pouco variada na leitura — soa mais monótona.'],
    });
    const rec = recommendNext({ progress: emptyProgress(), mode: 'shared', profile, sessions: [] });
    expect(rec).not.toBeNull();
    expect(['pros-melodia', 'mtf-fala-altura', 'ftm-fala-baixa']).toContain(rec!.lesson.id);
    expect(rec!.reason.length).toBeGreaterThan(10);
    expect(rec!.alternatives.length).toBeGreaterThan(0);
  });

  it('nunca devolve aula inexistente e sempre tem justificativa', () => {
    const rec = recommendNext({
      progress: emptyProgress(),
      mode: 'ftm',
      profile: makeProfile(),
      sessions: [],
    });
    expect(rec).not.toBeNull();
    expect(lessonById(rec!.lesson.id)).not.toBeNull();
    expect(rec!.reason).toBeTruthy();
  });

  it('nextInOrder ignora aulas concluídas', () => {
    const progress = emptyProgress();
    const first = nextInOrder(progress, 'shared');
    expect(first).not.toBeNull();
    const after = markLessonComplete(
      progress,
      TRAINING_MODULES[0],
      first!.id,
      new Date().toISOString(),
    );
    const second = nextInOrder(after, 'shared');
    expect(second?.id).not.toBe(first!.id);
  });

  it('progresso por módulo e geral', () => {
    const progress = emptyProgress();
    const mod = TRAINING_MODULES[0];
    const updated = markLessonComplete(progress, mod, mod.lessons[0].id, new Date().toISOString());
    expect(moduleCompletion(updated, mod)).toBe(Math.round((1 / mod.lessons.length) * 100));
    expect(overallCompletion(updated, 'shared')).toBeGreaterThan(0);
    expect(moduleSummary(updated, 'shared').length).toBeGreaterThan(0);
  });

  it('sequência de dias é calculada corretamente', () => {
    const today = new Date('2026-03-10T12:00:00Z');
    expect(computeStreak([], today)).toBe(0);
    expect(computeStreak(['2026-03-10T08:00:00Z'], today)).toBe(1);
    expect(computeStreak(['2026-03-10T08:00:00Z', '2026-03-09T09:00:00Z'], today)).toBe(2);
    expect(computeStreak(['2026-03-08T08:00:00Z'], today)).toBe(0); // esfriou
    expect(computeStreak(['2026-03-09T08:00:00Z'], today)).toBe(1); // ontem conta
  });
});

describe('perfil a partir da avaliação', () => {
  const step = (stepId: AssessmentStepResult['stepId'], patch = {}): AssessmentStepResult => ({
    stepId,
    recordedAt: new Date().toISOString(),
    durationSec: 6,
    metrics: makeMetrics(patch),
    note: '',
  });

  it('calcula piso, teto, extensão e posição do centro', () => {
    const steps = [
      step('fala-natural', { f0MedianHz: 130 }),
      step('vogal-confortavel', { f0MedianHz: 128 }),
      step('glissando-descida', { f0P5Hz: 82, f0MinHz: 78 }),
      step('glissando-subida', { f0P95Hz: 328, f0MaxHz: 350 }),
      step('ressonancia-escura', { resonanceIndex: 30 }),
      step('ressonancia-clara', { resonanceIndex: 62 }),
    ];
    const { profile } = buildProfile({ steps, mode: 'mtf' });
    expect(profile.floorHz).toBe(82);
    expect(profile.ceilingHz).toBe(328);
    expect(profile.comfortableHz).toBe(130);
    expect(profile.rangeSt).toBeGreaterThan(20);
    expect(profile.centerPosition).toBeGreaterThan(20);
    expect(profile.centerPosition).toBeLessThan(60);
    expect(profile.strengths.join(' ')).toMatch(/timbre/i);
  });

  it('funciona para voz muito grave e para voz aguda', () => {
    const bass = buildProfile({
      steps: [
        step('fala-natural', { f0MedianHz: 78 }),
        step('glissando-descida', { f0P5Hz: 55 }),
        step('glissando-subida', { f0P95Hz: 180 }),
      ],
      mode: 'mtf',
    }).profile;
    const soprano = buildProfile({
      steps: [
        step('fala-natural', { f0MedianHz: 265 }),
        step('glissando-descida', { f0P5Hz: 175 }),
        step('glissando-subida', { f0P95Hz: 620 }),
      ],
      mode: 'mtf',
    }).profile;
    expect(bass.rangeLabel).toBe('grave');
    expect(['medio-aguda', 'aguda']).toContain(soprano.rangeLabel);
    // ambos têm extensão comparável: nenhuma tessitura é privilegiada
    expect(Math.abs(bass.rangeSt - soprano.rangeSt)).toBeLessThan(8);
    expect(bass.centerPosition).toBeGreaterThan(10);
    expect(soprano.centerPosition).toBeGreaterThan(10);
  });

  it('tolera etapas ausentes', () => {
    const { profile, notes } = buildProfile({ steps: [step('fala-natural')], mode: 'shared' });
    expect(profile.floorHz).toBeNull();
    expect(profile.rangeLabel).toMatch(/grave|media|aguda/);
    expect(notes.length).toBeGreaterThan(0);
  });

  it('descreve faixas sem julgar', () => {
    expect(describeRange(90)).toBe('grave');
    expect(describeRange(200)).toBe('medio-aguda');
    expect(describeRange(null)).toBe('media');
  });

  it('sugere metas coerentes com o modo', () => {
    const mtf = suggestGoals(makeProfile({ comfortableHz: 120 }), 'mtf');
    const ftm = suggestGoals(makeProfile({ comfortableHz: 120 }), 'ftm');
    expect(mtf[0].target).toBeGreaterThan(120);
    expect(ftm[0].target).toBeLessThan(120);
    expect(mtf.every((g) => g.rationale.length > 20)).toBe(true);
  });

  it('protocolo cobre todas as etapas esperadas e é curto', () => {
    expect(ASSESSMENT_PROTOCOL.length).toBeGreaterThanOrEqual(6);
    const total = ASSESSMENT_PROTOCOL.reduce((a, s) => a + s.durationSec, 0);
    expect(total).toBeLessThan(240); // menos de 4 minutos
    expect(new Set(ASSESSMENT_PROTOCOL.map((s) => s.id)).size).toBe(ASSESSMENT_PROTOCOL.length);
  });
});

describe('feedback', () => {
  it('prioriza problemas de captura', () => {
    const items = generateFeedback({
      metrics: makeMetrics({
        qualityFlags: ['clipping', 'sinal-baixo'],
        clippingRatio: 0.05,
        levelMedianDb: -55,
      }),
      kind: 'sustentado',
    });
    expect(items[0].severity).toBe('atencao');
    expect(items.some((i) => i.id === 'clipping')).toBe(true);
    expect(items.every((i) => i.why.length > 20 && i.how.length > 20)).toBe(true);
  });

  it('explica o que, por que e como em cada item', () => {
    const items = generateFeedback({
      metrics: makeMetrics({ breathiness: 0.8, f0Stability: 40, hnrMedianDb: 8 }),
      kind: 'sustentado',
    });
    expect(items.length).toBeGreaterThanOrEqual(2);
    for (const i of items) {
      expect(i.title.length).toBeGreaterThan(3);
      expect(i.what.length).toBeGreaterThan(5);
      expect(i.why.length).toBeGreaterThan(20);
      expect(i.how.length).toBeGreaterThan(20);
    }
  });

  it('não recomenda apenas com base em frequência fundamental', () => {
    const items = generateFeedback({
      metrics: makeMetrics({ f0MedianHz: 90, resonanceIndex: 30, prosodySt: 2, breathiness: 0.7 }),
      kind: 'fala',
    });
    const howText = items.map((i) => `${i.how} ${i.why}`).join(' ');
    expect(items.some((i) => /resson|prosód|ar |flu(i)?xo/i.test(i.how))).toBe(true);
    expect(howText).not.toMatch(/apenas.*altura|somente.*frequência/i);
  });

  it('reconhece metas cumpridas', () => {
    const metrics = makeMetrics();
    const outcomes = evaluateTargets(
      metrics,
      [{ metric: 'f0Stability', op: '>=', label: 'estabilidade', weight: 1, value: 60 }],
      EMPTY_CONTEXT,
    );
    const items = generateFeedback({ metrics, targets: outcomes });
    expect(items.some((i) => i.id === 'metas-ok')).toBe(true);
  });

  it('limita a quantidade de itens para não sobrecarregar', () => {
    const items = generateFeedback({
      metrics: makeMetrics({
        qualityFlags: ['clipping', 'sinal-baixo', 'ruido-alto', 'amostra-curta'],
        clippingRatio: 0.1,
        levelMedianDb: -60,
        f0Stability: 20,
        levelStability: 20,
        breathiness: 0.9,
        hnrMedianDb: 3,
        prosodySt: 1,
        registerBreaks: 9,
      }),
      kind: 'fala',
    });
    expect(items.length).toBeLessThanOrEqual(7);
  });

  it('sinaliza falta de calibração de forma informativa', () => {
    const items = generateFeedback({ metrics: makeMetrics(), calibration: false });
    expect(items.some((i) => i.id === 'sem-calibracao')).toBe(true);
  });
});

describe('comparação antes/depois', () => {
  it('resume mudanças em linguagem natural', () => {
    const a = makeMetrics({ f0MedianHz: 110, resonanceIndex: 30, f0Stability: 60 });
    const b = makeMetrics({ f0MedianHz: 124, resonanceIndex: 48, f0Stability: 75 });
    const result = compareSessions(a, b);
    expect(result.deltas.length).toBeGreaterThan(5);
    expect(result.summary.join(' ')).toMatch(/semitons/);
    expect(result.summary.join(' ')).toMatch(/Ressonância/);
  });

  it('avisa quando não há diferença relevante', () => {
    const a = makeMetrics();
    const result = compareSessions(a, { ...a });
    expect(result.summary[0]).toMatch(/próximas/);
  });
});

describe('sessões', () => {
  it('registro de sessão é serializável e estável', () => {
    const s: SessionRecord = {
      id: 'abc',
      createdAt: new Date().toISOString(),
      mode: 'mtf',
      kind: 'sustentado',
      durationSec: 6.2,
      metrics: makeMetrics(),
      score: 80,
      recordingId: null,
      feedback: [],
    };
    expect(JSON.parse(JSON.stringify(s)).metrics.f0MedianHz).toBe(130);
  });
});
