import { describe, expect, it } from 'vitest';
import {
  applyLessonResult,
  computeStreak,
  emptyProgress,
  isUnlocked,
  markLessonComplete,
  moduleCompletion,
  overallCompletion,
  practiceMinutes,
  refreshDerived,
} from '@core/training/progress';
import { TRAINING_MODULES, lessonById, modulesForMode } from '@core/training/curriculum';
import type { SessionRecord } from '@shared/types';
import { makeLessonResult, makeMetrics } from './helpers/metrics';

const fundamentos = TRAINING_MODULES.find((m) => m.id === 'fundamentos')!;
const primeiraAula = fundamentos.lessons[0];

const session = (createdAt: string, durationSec = 60): SessionRecord => ({
  id: `s-${createdAt}`,
  createdAt,
  mode: 'mtf',
  kind: 'sustentado',
  lessonId: 'fund-respiracao',
  durationSec,
  metrics: makeMetrics(),
  score: 80,
  recordingId: null,
  feedback: [],
});

describe('computeStreak', () => {
  const hoje = new Date('2026-03-10T12:00:00.000Z');

  it('sem prática, sequência zero', () => {
    expect(computeStreak([], hoje)).toBe(0);
  });

  it('conta dias consecutivos terminando hoje', () => {
    expect(
      computeStreak(
        ['2026-03-08T09:00:00.000Z', '2026-03-09T09:00:00.000Z', '2026-03-10T09:00:00.000Z'],
        hoje,
      ),
    ).toBe(3);
  });

  it('aceita sequência que termina ontem (hoje ainda não praticou)', () => {
    expect(computeStreak(['2026-03-08T09:00:00.000Z', '2026-03-09T23:00:00.000Z'], hoje)).toBe(2);
  });

  it('duas sessões no mesmo dia contam como um dia', () => {
    expect(
      computeStreak(
        ['2026-03-10T08:00:00.000Z', '2026-03-10T20:00:00.000Z', '2026-03-09T10:00:00.000Z'],
        hoje,
      ),
    ).toBe(2);
  });

  it('buraco no meio interrompe a contagem', () => {
    expect(
      computeStreak(
        ['2026-03-10T09:00:00.000Z', '2026-03-09T09:00:00.000Z', '2026-03-07T09:00:00.000Z'],
        hoje,
      ),
    ).toBe(2);
  });

  it('prática antiga sem nada recente zera a sequência', () => {
    expect(computeStreak(['2026-02-01T09:00:00.000Z'], hoje)).toBe(0);
  });
});

describe('applyLessonResult', () => {
  it('grava sob o módulo do currículo, não sob o prefixo do id', () => {
    const out = applyLessonResult(
      emptyProgress(),
      makeLessonResult({ lessonId: 'fund-respiracao', score: 70 }),
    );
    expect(Object.keys(out.modules)).toContain('fundamentos');
    expect(Object.keys(out.modules)).not.toContain('fund');
    expect(out.lessons['fund-respiracao']).toMatchObject({ attempts: 1, bestScore: 70 });
  });

  it('soma tentativas e mantém a melhor nota', () => {
    let progress = emptyProgress();
    progress = applyLessonResult(
      progress,
      makeLessonResult({ score: 90, completedAt: '2026-03-10T09:00:00.000Z' }),
    );
    progress = applyLessonResult(
      progress,
      makeLessonResult({ score: 40, completedAt: '2026-03-11T09:00:00.000Z' }),
    );
    expect(progress.lessons['fund-respiracao']).toEqual({
      attempts: 2,
      bestScore: 90,
      lastAt: '2026-03-11T09:00:00.000Z',
    });
  });
});

describe('markLessonComplete', () => {
  it('não faz nada quando o id da aula é vazio', () => {
    const progress = emptyProgress();
    expect(markLessonComplete(progress, fundamentos, '', '2026-03-10T09:00:00.000Z')).toBe(
      progress,
    );
  });

  it('marca a aula uma única vez e atualiza o último treino', () => {
    const at = '2026-03-10T09:00:00.000Z';
    let progress = markLessonComplete(emptyProgress(), fundamentos, primeiraAula.id, at);
    progress = markLessonComplete(
      progress,
      fundamentos,
      primeiraAula.id,
      '2026-03-11T09:00:00.000Z',
    );
    expect(progress.modules.fundamentos.completedLessons).toEqual([primeiraAula.id]);
    expect(progress.modules.fundamentos.lastPracticedAt).toBe('2026-03-11T09:00:00.000Z');
    expect(progress.lessons[primeiraAula.id]).toMatchObject({
      attempts: 0,
      lastAt: '2026-03-11T09:00:00.000Z',
    });
  });
});

describe('completion', () => {
  it('módulo sem aulas e sem progresso mede 0%', () => {
    const vazio = { ...fundamentos, lessons: [] };
    expect(moduleCompletion(emptyProgress(), vazio)).toBe(0);
  });

  it('conta as aulas concluídas do módulo', () => {
    const metade = {
      ...emptyProgress(),
      modules: {
        fundamentos: {
          moduleId: 'fundamentos',
          completedLessons: [fundamentos.lessons[0].id, fundamentos.lessons[1].id],
          lastPracticedAt: null,
        },
      },
    };
    const esperado = Math.round((2 / fundamentos.lessons.length) * 100);
    expect(moduleCompletion(metade, fundamentos)).toBe(esperado);
  });

  it('progresso geral soma todos os módulos do modo', () => {
    const mods = modulesForMode('mtf');
    const total = mods.reduce((a, m) => a + m.lessons.length, 0);
    const primeira = mods[0];
    const progress = {
      ...emptyProgress(),
      modules: {
        [primeira.id]: {
          moduleId: primeira.id,
          completedLessons: primeira.lessons.map((l) => l.id),
          lastPracticedAt: null,
        },
      },
    };
    expect(overallCompletion(progress, 'mtf')).toBe(
      Math.round((primeira.lessons.length / total) * 100),
    );
  });

  it('modo sem módulos mede 0% (sem divisão por zero)', () => {
    expect(overallCompletion(emptyProgress(), 'shared')).toBeGreaterThanOrEqual(0);
  });
});

describe('isUnlocked', () => {
  it('sem pré-requisitos está sempre liberada', () => {
    expect(isUnlocked(emptyProgress(), 'qualquer', [])).toBe(true);
    expect(isUnlocked(emptyProgress(), 'qualquer')).toBe(true);
  });

  it('exige todos os pré-requisitos concluídos, no módulo certo', () => {
    const progress = {
      ...emptyProgress(),
      modules: {
        fundamentos: {
          moduleId: 'fundamentos',
          completedLessons: ['fund-respiracao'],
          lastPracticedAt: null,
        },
      },
    };
    expect(isUnlocked(progress, 'x', ['fund-respiracao'])).toBe(true);
    expect(isUnlocked(progress, 'x', ['fund-respiracao', 'fund-aquecimento'])).toBe(false);
    expect(isUnlocked(progress, 'x', ['mapeamento-faixa'])).toBe(false);
  });

  it('usa ids reais do currículo', () => {
    expect(lessonById(primeiraAula.id)?.moduleId).toBe('fundamentos');
  });
});

describe('practiceMinutes e refreshDerived', () => {
  it('soma durações ignorando valores inválidos', () => {
    expect(practiceMinutes([])).toBe(0);
    expect(practiceMinutes([session('2026-03-10T09:00:00.000Z', 90)])).toBe(2);
    expect(
      practiceMinutes([
        session('2026-03-10T09:00:00.000Z', 60),
        { ...session('2026-03-11T09:00:00.000Z'), durationSec: Number.NaN },
      ]),
    ).toBe(1);
  });

  it('recalcula sequência, último dia e minutos', () => {
    const hoje = new Date();
    const ontem = new Date(hoje.getTime() - 86400000);
    const out = refreshDerived(emptyProgress(), [
      session(ontem.toISOString(), 60),
      session(hoje.toISOString(), 120),
    ]);
    expect(out.streakDays).toBe(2);
    expect(out.totalPracticeMinutes).toBe(3);
    expect(out.lastPracticeDate).toBe(hoje.toISOString().slice(0, 10));
  });

  it('sem sessões preserva o último dia já registrado', () => {
    const antes = { ...emptyProgress(), lastPracticeDate: '2026-03-01' };
    const out = refreshDerived(antes, []);
    expect(out.lastPracticeDate).toBe('2026-03-01');
    expect(out.streakDays).toBe(0);
    expect(out.totalPracticeMinutes).toBe(0);
  });
});
