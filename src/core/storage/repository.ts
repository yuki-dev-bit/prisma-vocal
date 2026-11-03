/**
 * Repositório de dados: funções puras que operam sobre `AppData`.
 *
 * O processo principal do Electron usa estas funções para persistir; o modo
 * navegador usa as mesmas funções com outro armazenamento. Assim a lógica de
 * dados é testável e não depende de I/O.
 */
import {
  AppData,
  AppSettings,
  Goal,
  JournalEntry,
  LessonResult,
  RecordingMeta,
  SessionRecord,
  UserSummary,
} from '../../shared/types';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../settings/defaults';
import { emptyProgress } from '../training/progress';

export const SCHEMA_VERSION = 1;
/** Limite de sessões mantidas no histórico (as mais antigas são agregadas/removidas). */
export const MAX_SESSIONS = 3000;
export const MAX_JOURNAL = 2000;

export function createInitialData(overrides: Partial<AppData> = {}): AppData {
  const user: UserSummary = {
    displayName: '',
    createdAt: new Date().toISOString(),
    selfDescription: '',
    goalsStatement: '',
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    user,
    settings: DEFAULT_SETTINGS,
    profile: null,
    assessment: null,
    progress: emptyProgress(),
    sessions: [],
    recordings: [],
    journal: [],
    goals: [],
    ...overrides,
  };
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * Migra e valida dados lidos do disco. Nunca lança: em caso de corrupção
 * devolve o que for recuperável + lista de problemas (para log e UI).
 */
export function migrateData(raw: unknown): { data: AppData; issues: string[] } {
  const issues: string[] = [];
  // Primeira execução: nada foi gravado ainda, isso não é um problema.
  if (raw === null || raw === undefined) return { data: createInitialData(), issues };
  if (!isObj(raw)) {
    return {
      data: createInitialData(),
      issues: ['Arquivo de dados com formato inesperado: iniciado banco novo.'],
    };
  }
  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version > SCHEMA_VERSION) {
    issues.push(
      `Dados criados por uma versão mais nova (v${version}); campos desconhecidos serão ignorados.`,
    );
  }
  const { settings, changed } = sanitizeSettings(raw.settings);
  if (changed) issues.push('Configurações fora da faixa esperada foram corrigidas.');

  const sessions = arr<SessionRecord>(raw.sessions)
    .filter((s) => isObj(s) && typeof s.id === 'string' && isObj(s.metrics))
    .slice(-MAX_SESSIONS);
  const recordings = arr<RecordingMeta>(raw.recordings).filter(
    (r) => isObj(r) && typeof r.id === 'string' && typeof r.createdAt === 'string',
  );
  const journal = arr<JournalEntry>(raw.journal)
    .filter((j) => isObj(j) && typeof j.id === 'string')
    .slice(-MAX_JOURNAL);
  const goals = arr<Goal>(raw.goals).filter(
    (g) => isObj(g) && typeof g.id === 'string' && typeof g.metric === 'string',
  );
  const progress = isObj(raw.progress)
    ? (raw.progress as unknown as AppData['progress'])
    : emptyProgress();

  const data: AppData = {
    schemaVersion: SCHEMA_VERSION,
    user: isObj(raw.user)
      ? { ...createInitialData().user, ...(raw.user as unknown as UserSummary) }
      : createInitialData().user,
    settings,
    profile: isObj(raw.profile) ? (raw.profile as unknown as AppData['profile']) : null,
    assessment: isObj(raw.assessment) ? (raw.assessment as unknown as AppData['assessment']) : null,
    progress: {
      lessons: isObj(progress.lessons) ? progress.lessons : {},
      modules: isObj(progress.modules) ? progress.modules : {},
      streakDays: Number(progress.streakDays) || 0,
      lastPracticeDate:
        typeof progress.lastPracticeDate === 'string' ? progress.lastPracticeDate : null,
      totalPracticeMinutes: Number(progress.totalPracticeMinutes) || 0,
    },
    sessions,
    recordings,
    journal,
    goals,
  };
  if (sessions.length !== arr(raw.sessions).length)
    issues.push('Algumas sessões inválidas foram descartadas.');
  return { data, issues };
}

export function addSession(data: AppData, session: SessionRecord): AppData {
  const sessions = [...data.sessions, session];
  return {
    ...data,
    sessions: sessions.length > MAX_SESSIONS ? sessions.slice(-MAX_SESSIONS) : sessions,
  };
}

export function updateSessionFeedback(
  data: AppData,
  sessionId: string,
  patch: Partial<SessionRecord>,
): AppData {
  return {
    ...data,
    sessions: data.sessions.map((s) => (s.id === sessionId ? { ...s, ...patch, id: s.id } : s)),
  };
}

export function addRecording(data: AppData, meta: RecordingMeta): AppData {
  return { ...data, recordings: [...data.recordings, meta] };
}

export function removeRecording(data: AppData, id: string): AppData {
  return {
    ...data,
    recordings: data.recordings.filter((r) => r.id !== id),
    sessions: data.sessions.map((s) => (s.recordingId === id ? { ...s, recordingId: null } : s)),
  };
}

export function addJournalEntry(data: AppData, entry: JournalEntry): AppData {
  const journal = [...data.journal, entry].slice(-MAX_JOURNAL);
  return { ...data, journal };
}

export function updateJournalEntry(data: AppData, entry: JournalEntry): AppData {
  return { ...data, journal: data.journal.map((j) => (j.id === entry.id ? entry : j)) };
}

export function removeJournalEntry(data: AppData, id: string): AppData {
  return { ...data, journal: data.journal.filter((j) => j.id !== id) };
}

export function upsertGoal(data: AppData, goal: Goal): AppData {
  const exists = data.goals.some((g) => g.id === goal.id);
  return {
    ...data,
    goals: exists ? data.goals.map((g) => (g.id === goal.id ? goal : g)) : [...data.goals, goal],
  };
}

export function removeGoal(data: AppData, id: string): AppData {
  return { ...data, goals: data.goals.filter((g) => g.id !== id) };
}

export function recordLessonResult(data: AppData, result: LessonResult, moduleId: string): AppData {
  const lessons = { ...data.progress.lessons };
  const prev = lessons[result.lessonId];
  lessons[result.lessonId] = {
    attempts: (prev?.attempts ?? 0) + 1,
    bestScore: Math.max(prev?.bestScore ?? 0, result.score),
    lastAt: result.completedAt,
  };
  const mod = data.progress.modules[moduleId] ?? {
    moduleId,
    completedLessons: [],
    lastPracticedAt: null,
  };
  const completedLessons = mod.completedLessons.includes(result.lessonId)
    ? mod.completedLessons
    : [...mod.completedLessons, result.lessonId];
  return {
    ...data,
    progress: {
      ...data.progress,
      lessons,
      modules: {
        ...data.progress.modules,
        [moduleId]: { ...mod, completedLessons, lastPracticedAt: result.completedAt },
      },
    },
  };
}

/** Remove gravações vencidas e (quando pedido) sessões muito antigas. */
export function applyRetention(
  data: AppData,
  now = new Date(),
): { data: AppData; removedRecordingIds: string[] } {
  const days = data.settings.privacy.retentionDays;
  if (!days || days <= 0) return { data, removedRecordingIds: [] };
  const cutoff = now.getTime() - days * 86400000;
  const removedRecordingIds = data.recordings
    .filter((r) => new Date(r.createdAt).getTime() < cutoff)
    .map((r) => r.id);
  if (removedRecordingIds.length === 0) return { data, removedRecordingIds: [] };
  const set = new Set(removedRecordingIds);
  return {
    data: {
      ...data,
      recordings: data.recordings.filter((r) => !set.has(r.id)),
      sessions: data.sessions.map((s) =>
        s.recordingId && set.has(s.recordingId) ? { ...s, recordingId: null } : s,
      ),
    },
    removedRecordingIds,
  };
}

/** Apaga todo conteúdo pessoal, preservando apenas configurações. */
export function clearPersonalData(settings: AppSettings): AppData {
  return createInitialData({ settings });
}

/** Estatísticas leves para o painel inicial. */
export function quickStats(data: AppData): {
  sessions: number;
  minutes: number;
  recordings: number;
  lastSessionAt: string | null;
  avgScore: number | null;
} {
  const scored = data.sessions.filter((s) => typeof s.score === 'number');
  const last = data.sessions.at(-1);
  return {
    sessions: data.sessions.length,
    minutes: Math.round(data.sessions.reduce((a, s) => a + s.durationSec, 0) / 60),
    recordings: data.recordings.length,
    lastSessionAt: last?.createdAt ?? null,
    avgScore: scored.length
      ? Math.round(scored.reduce((a, s) => a + (s.score ?? 0), 0) / scored.length)
      : null,
  };
}
