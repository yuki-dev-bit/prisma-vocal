/**
 * Progresso do treino: conclusão de aulas, sequência de dias, minutos.
 * Funções puras — recebem estado e devolvem novos valores (nunca mutam).
 */
import {
  LessonResult,
  ProgressState,
  SessionRecord,
  TrainingMode,
  TrainingModule,
} from '../../shared/types';
import { LESSON_INDEX, modulesForMode } from './curriculum';

export const emptyProgress = (): ProgressState => ({
  lessons: {},
  modules: {},
  streakDays: 0,
  lastPracticeDate: null,
  totalPracticeMinutes: 0,
});

const dayKey = (iso: string): string => iso.slice(0, 10);

/** Dias consecutivos com prática, contando a partir de hoje/ontem. */
export function computeStreak(dates: string[], today = new Date()): number {
  if (dates.length === 0) return 0;
  const unique = Array.from(new Set(dates.map(dayKey)))
    .sort()
    .reverse();
  const todayKey = today.toISOString().slice(0, 10);
  const yesterday = new Date(today.getTime() - 86400000).toISOString().slice(0, 10);
  if (unique[0] !== todayKey && unique[0] !== yesterday) return 0;
  let streak = 1;
  let cursor = new Date(`${unique[0]}T00:00:00Z`);
  for (let i = 1; i < unique.length; i++) {
    const prev = new Date(cursor.getTime() - 86400000).toISOString().slice(0, 10);
    if (unique[i] === prev) {
      streak++;
      cursor = new Date(cursor.getTime() - 86400000);
    } else if (unique[i] < prev) {
      break;
    }
  }
  return streak;
}

export function applyLessonResult(progress: ProgressState, result: LessonResult): ProgressState {
  const existing = progress.lessons[result.lessonId];
  const lessons = {
    ...progress.lessons,
    [result.lessonId]: {
      attempts: (existing?.attempts ?? 0) + 1,
      bestScore: Math.max(existing?.bestScore ?? 0, result.score),
      lastAt: result.completedAt,
    },
  };
  const modules = { ...progress.modules };
  // O id da aula não carrega o id do módulo ('fund-respiracao' → 'fundamentos'):
  // a origem da verdade é o currículo.
  const moduleId = LESSON_INDEX.get(result.lessonId)?.module.id ?? result.lessonId.split('-')[0];
  const prev = modules[moduleId];
  modules[moduleId] = {
    moduleId,
    completedLessons: prev?.completedLessons ?? [],
    lastPracticedAt: result.completedAt,
  };
  return { ...progress, lessons, modules };
}

/** Marca a aula como concluída quando todos os exercícios foram feitos. */
export function markLessonComplete(
  progress: ProgressState,
  module: TrainingModule,
  lessonId: string,
  at: string,
): ProgressState {
  if (!lessonId) return progress;
  const lessons = { ...progress.lessons };
  const entry = lessons[lessonId] ?? { attempts: 0, bestScore: 0, lastAt: at };
  lessons[lessonId] = { ...entry, lastAt: at };
  const mod = progress.modules[module.id] ?? {
    moduleId: module.id,
    completedLessons: [],
    lastPracticedAt: null,
  };
  const completed = mod.completedLessons.includes(lessonId)
    ? mod.completedLessons
    : [...mod.completedLessons, lessonId];
  return {
    ...progress,
    lessons,
    modules: {
      ...progress.modules,
      [module.id]: { ...mod, completedLessons: completed, lastPracticedAt: at },
    },
  };
}

export function moduleCompletion(progress: ProgressState, module: TrainingModule): number {
  const done = progress.modules[module.id]?.completedLessons.length ?? 0;
  return module.lessons.length === 0 ? 0 : Math.round((done / module.lessons.length) * 100);
}

export function overallCompletion(progress: ProgressState, mode: TrainingMode): number {
  const mods = modulesForMode(mode);
  const total = mods.reduce((a, m) => a + m.lessons.length, 0);
  const done = mods.reduce((a, m) => a + (progress.modules[m.id]?.completedLessons.length ?? 0), 0);
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

/** Verifica pré-requisitos de uma aula. */
export function isUnlocked(
  progress: ProgressState,
  _lessonId: string,
  requires: string[] = [],
): boolean {
  // O id da aula não começa com o id do módulo ('fund-respiracao' pertence a
  // 'fundamentos'), então o módulo vem do currículo — não de `split('-')`.
  return requires.every((r) => {
    const moduleId = LESSON_INDEX.get(r)?.module.id;
    if (!moduleId) return false;
    return progress.modules[moduleId]?.completedLessons.includes(r) ?? false;
  });
}

export function practiceMinutes(sessions: SessionRecord[]): number {
  const secs = sessions.reduce(
    (a, s) => a + (Number.isFinite(s.durationSec) ? s.durationSec : 0),
    0,
  );
  return Math.round(secs / 60);
}

/** Atualiza contadores derivados (streak, minutos) de forma idempotente. */
export function refreshDerived(progress: ProgressState, sessions: SessionRecord[]): ProgressState {
  const dates = sessions.map((s) => s.createdAt);
  const streak = computeStreak(dates);
  const last = dates.sort().at(-1) ?? null;
  return {
    ...progress,
    streakDays: streak,
    lastPracticeDate: last ? dayKey(last) : progress.lastPracticeDate,
    totalPracticeMinutes: practiceMinutes(sessions),
  };
}
