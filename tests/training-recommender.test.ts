import { describe, expect, it } from 'vitest';
import { moduleSummary, nextInOrder, recommendNext } from '@core/training/recommender';
import { emptyProgress, markLessonComplete } from '@core/training/progress';
import { TRAINING_MODULES, modulesForMode } from '@core/training/curriculum';
import type { ProgressState, SessionRecord } from '@shared/types';
import { makeMetrics, makeProfile } from './helpers/metrics';

const session = (patch: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  createdAt: '2026-03-10T09:00:00.000Z',
  mode: 'mtf',
  kind: 'sustentado',
  durationSec: 60,
  metrics: makeMetrics(),
  score: 80,
  recordingId: null,
  feedback: [],
  ...patch,
});

const tudoCompleto = (mode: 'mtf' | 'ftm' | 'shared', except: string[] = []): ProgressState => {
  let progress = emptyProgress();
  for (const m of modulesForMode(mode)) {
    for (const l of m.lessons) {
      if (except.includes(l.id)) continue;
      progress = markLessonComplete(progress, m, l.id, '2026-03-01T09:00:00.000Z');
    }
  }
  return progress;
};

describe('recommendNext', () => {
  it('sem avaliação, recomenda só fundamentos e sinaliza a pendência', () => {
    const rec = recommendNext({
      progress: emptyProgress(),
      mode: 'mtf',
      profile: null,
      sessions: [],
    })!;
    expect(rec).not.toBeNull();
    expect(rec.needsAssessment).toBe(true);
    expect(rec.moduleId).toBe('fundamentos');
  });

  it('com avaliação, prioriza a aula que ataca a dificuldade medida', () => {
    // Dificuldade de timbre aponta para aulas fora de fundamentos: é o caso em
    // que a recomendação precisa sair da trilha inicial.
    const rec = recommendNext({
      progress: emptyProgress(),
      mode: 'mtf',
      profile: makeProfile({ challenges: ['controle de ressonância e timbre'] }),
      sessions: [],
    })!;
    expect(rec.needsAssessment).toBe(false);
    expect(rec.moduleId).not.toBe('fundamentos');
    // a aula escolhida tem de estar entre as que treinam timbre, não qualquer uma
    expect(['res-claro-escuro', 'mtf-brilho', 'ftm-ressonancia']).toContain(rec.lesson.id);
    expect(rec.reason).toMatch(/timbre/i);
    expect(rec.score).toBeGreaterThan(100 - 40); // subiu acima do teto da trilha base
  });

  it('sobe a prioridade de aula já praticada com nota baixa', () => {
    const progress = {
      ...emptyProgress(),
      lessons: { 'fund-respiracao': { attempts: 1, bestScore: 40, lastAt: '2026-03-01' } },
    };
    const rec = recommendNext({ progress, mode: 'shared', profile: null, sessions: [] })!;
    expect(rec.lesson.id).toBe('fund-respiracao');
    expect(rec.reason).toMatch(/abaixo de 60/);
  });

  it('usa a estabilidade das últimas sessões como justificativa', () => {
    const rec = recommendNext({
      progress: emptyProgress(),
      mode: 'shared',
      profile: makeProfile(),
      sessions: [session({ metrics: makeMetrics({ f0Stability: 30 }) })],
    })!;
    expect(rec.reason).toMatch(/estabilidade de altura/i);
  });

  it('oferece até 3 alternativas, sem repetir a escolhida', () => {
    const rec = recommendNext({
      progress: emptyProgress(),
      mode: 'mtf',
      profile: makeProfile(),
      sessions: [],
    })!;
    expect(rec.alternatives.length).toBeLessThanOrEqual(3);
    expect(rec.alternatives.map((a) => a.lessonId)).not.toContain(rec.lesson.id);
    for (const alt of rec.alternatives) {
      expect(alt.title.length).toBeGreaterThan(0);
      expect(alt.reason.length).toBeGreaterThan(0);
    }
  });

  it('a aula devolvida carrega o módulo certo', () => {
    const rec = recommendNext({
      progress: emptyProgress(),
      mode: 'shared',
      profile: makeProfile(),
      sessions: [],
    })!;
    const dono = TRAINING_MODULES.find((m) => m.lessons.some((l) => l.id === rec.lesson.id))!;
    expect(rec.moduleId).toBe(dono.id);
    expect(rec.moduleTitle).toBe(dono.title);
  });
});

describe('nextInOrder', () => {
  it('trilha intacta começa pela primeira aula do primeiro módulo', () => {
    const primeiro = modulesForMode('shared').sort((a, b) => a.order - b.order)[0];
    expect(nextInOrder(emptyProgress(), 'shared')?.id).toBe(primeiro.lessons[0].id);
  });

  it('pula o que já foi feito e devolve a próxima pendente', () => {
    const mods = modulesForMode('mtf').sort((a, b) => a.order - b.order);
    const primeira = mods[0].lessons[0];
    const segunda = mods[0].lessons[1];
    const progress = markLessonComplete(emptyProgress(), mods[0], primeira.id, '2026-03-01');
    expect(nextInOrder(progress, 'mtf')?.id).toBe(segunda.id);
  });

  it('trilha concluída devolve null (nada a continuar)', () => {
    expect(nextInOrder(tudoCompleto('mtf'), 'mtf')).toBeNull();
  });
});

describe('moduleSummary', () => {
  it('lista os módulos do modo em ordem, com conclusão e contagem', () => {
    const mods = modulesForMode('ftm').sort((a, b) => a.order - b.order);
    const progress = markLessonComplete(
      emptyProgress(),
      mods[0],
      mods[0].lessons[0].id,
      '2026-03-01',
    );
    const resumo = moduleSummary(progress, 'ftm');

    expect(resumo.map((m) => m.id)).toEqual(mods.map((m) => m.id));
    expect(resumo[0].done).toBe(1);
    expect(resumo[0].lessons).toBe(mods[0].lessons.length);
    expect(resumo[0].completion).toBe(Math.round((1 / mods[0].lessons.length) * 100));
    expect(resumo[1].done).toBe(0);
    expect(resumo[1].completion).toBe(0);
  });
});

describe('recommendNext — ressonância recente', () => {
  it('prioriza aula de timbre quando a ressonância medida está baixa', () => {
    const mods = modulesForMode('mtf').sort((a, b) => a.order - b.order);
    let progress = emptyProgress();
    for (const m of mods) {
      for (const l of m.lessons) {
        if (l.id === 'res-claro-escuro') continue;
        progress = markLessonComplete(progress, m, l.id, '2026-03-01T09:00:00.000Z');
      }
    }
    // aulas já feitas com nota boa não voltam a competir
    const lessons = Object.fromEntries(
      Object.keys(progress.lessons).map((id) => [
        id,
        { attempts: 2, bestScore: 85, lastAt: '2026-03-01T09:00:00.000Z' },
      ]),
    );

    const rec = recommendNext({
      progress: { ...progress, lessons },
      mode: 'mtf',
      profile: makeProfile(),
      sessions: [session({ metrics: makeMetrics({ resonanceIndex: 20 }) })],
    })!;

    // a escolhida tem de treinar ressonância (pode ser mais de uma aula)
    expect(['res-claro-escuro', 'mtf-brilho', 'mtf-consistencia', 'fund-escuta']).toContain(
      rec.lesson.id,
    );
    expect(rec.reason).toMatch(/ressonância recente/i);
  });

  it('sem perfil de voz, a falta de ressonância não vira justificativa', () => {
    const rec = recommendNext({
      progress: emptyProgress(),
      mode: 'mtf',
      profile: null,
      sessions: [session({ metrics: makeMetrics({ resonanceIndex: 10 }) })],
    })!;
    expect(rec.reason).not.toMatch(/ressonância recente/i);
  });
});
