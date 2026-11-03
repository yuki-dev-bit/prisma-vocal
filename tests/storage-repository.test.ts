import { describe, expect, it } from 'vitest';
import {
  MAX_JOURNAL,
  MAX_SESSIONS,
  SCHEMA_VERSION,
  addJournalEntry,
  addRecording,
  addSession,
  applyRetention,
  clearPersonalData,
  createInitialData,
  migrateData,
  quickStats,
  recordLessonResult,
  removeGoal,
  removeJournalEntry,
  removeRecording,
  updateJournalEntry,
  updateSessionFeedback,
  upsertGoal,
} from '@core/storage/repository';
import { DEFAULT_SETTINGS } from '@core/settings/defaults';
import type { Goal, JournalEntry, RecordingMeta, SessionRecord } from '@shared/types';
import { makeLessonResult, makeMetrics } from './helpers/metrics';

const session = (patch: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  createdAt: '2026-03-01T10:00:00.000Z',
  mode: 'mtf',
  kind: 'sustentado',
  lessonId: 'fundamentos-1',
  durationSec: 120,
  metrics: makeMetrics(),
  score: 80,
  recordingId: null,
  feedback: [],
  ...patch,
});

const recording = (id: string, createdAt = '2026-03-01T10:00:00.000Z'): RecordingMeta => ({
  id,
  createdAt,
  label: `tomada ${id}`,
  kind: 'avaliacao',
  durationSec: 5,
  sampleRate: 48000,
  encrypted: false,
  metrics: null,
  tags: [],
});

const entry = (id: string, patch: Partial<JournalEntry> = {}): JournalEntry => ({
  id,
  date: '2026-03-01',
  mood: 3,
  energy: 3,
  notes: 'nota',
  tags: [],
  ...patch,
});

const goal = (id: string, patch: Partial<Goal> = {}): Goal => ({
  id,
  title: 'subir o centro da fala',
  createdAt: '2026-03-01T10:00:00.000Z',
  targetDate: null,
  metric: 'f0MedianHz',
  target: 150,
  relativeTo: 'baseline',
  baselineValue: 138,
  status: 'ativa',
  note: '',
  ...patch,
});

describe('createInitialData', () => {
  it('cria um banco vazio na versão de esquema atual', () => {
    const data = createInitialData();
    expect(data.schemaVersion).toBe(SCHEMA_VERSION);
    expect(data.sessions).toEqual([]);
    expect(data.journal).toEqual([]);
    expect(data.recordings).toEqual([]);
    expect(data.goals).toEqual([]);
    expect(data.profile).toBeNull();
    expect(data.assessment).toBeNull();
    expect(data.settings).toEqual(DEFAULT_SETTINGS);
    expect(data.progress.streakDays).toBe(0);
    expect(Number.isNaN(Date.parse(data.user.createdAt))).toBe(false);
  });

  it('aceita sobrescritas sem perder o resto do esqueleto', () => {
    const data = createInitialData({ sessions: [session()] });
    expect(data.sessions).toHaveLength(1);
    expect(data.journal).toEqual([]);
  });
});

describe('migrateData', () => {
  it('primeira execução (sem arquivo) não gera problema', () => {
    for (const raw of [null, undefined]) {
      const { data, issues } = migrateData(raw);
      expect(issues).toEqual([]);
      expect(data.sessions).toEqual([]);
    }
  });

  it('arquivo com formato inesperado reinicia o banco e avisa', () => {
    const { data, issues } = migrateData('isto não é um objeto');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/formato inesperado/i);
    expect(data.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('dados de versão mais nova não são descartados, mas avisam', () => {
    const { data, issues } = migrateData({ schemaVersion: SCHEMA_VERSION + 5, sessions: [] });
    expect(issues.some((i) => /versão mais nova/i.test(i))).toBe(true);
    expect(data.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('descarta sessões inválidas e reporta a perda', () => {
    const { data, issues } = migrateData({
      sessions: [
        session({ id: 'ok' }),
        { id: 'sem-metricas' },
        { metrics: makeMetrics() },
        'lixo',
        null,
      ],
    });
    expect(data.sessions.map((s) => s.id)).toEqual(['ok']);
    expect(issues.some((i) => /sessões inválidas/i.test(i))).toBe(true);
  });

  it('filtra gravações, diário e metas inválidos sem derrubar o resto', () => {
    const { data } = migrateData({
      recordings: [recording('r1'), { id: 'sem-data' }, { createdAt: '2026-01-01' }],
      journal: [entry('j1'), { notes: 'sem id' }],
      goals: [goal('g1'), { id: 'g2' }, { metric: 'hnrDb' }],
    });
    expect(data.recordings.map((r) => r.id)).toEqual(['r1']);
    expect(data.journal.map((j) => j.id)).toEqual(['j1']);
    expect(data.goals.map((g) => g.id)).toEqual(['g1']);
  });

  it('corrige configurações fora da faixa e avisa', () => {
    const { data, issues } = migrateData({
      settings: { audio: { gainDb: 900 }, ui: { fontScale: 99 }, privacy: { retentionDays: -5 } },
    });
    expect(issues.some((i) => /Configurações fora da faixa/i.test(i))).toBe(true);
    expect(data.settings.audio.gainDb).toBeLessThanOrEqual(24);
    expect(data.settings.ui.fontScale).toBeLessThanOrEqual(1.6);
    expect(data.settings.privacy.retentionDays).toBeGreaterThanOrEqual(0);
  });

  it('reconstrói progresso corrompido com valores neutros', () => {
    const { data } = migrateData({
      progress: { lessons: 'x', modules: 3, streakDays: 'muitos', lastPracticeDate: 42 },
    });
    expect(data.progress.lessons).toEqual({});
    expect(data.progress.modules).toEqual({});
    expect(data.progress.streakDays).toBe(0);
    expect(data.progress.lastPracticeDate).toBeNull();
    expect(data.progress.totalPracticeMinutes).toBe(0);
  });

  it('preserva progresso válido e campos desconhecidos do usuário', () => {
    const { data } = migrateData({
      progress: {
        lessons: { 'fundamentos-1': { attempts: 3, bestScore: 90, lastAt: '2026-03-01' } },
        modules: {
          fundamentos: {
            moduleId: 'fundamentos',
            completedLessons: ['fundamentos-1'],
            lastPracticedAt: null,
          },
        },
        streakDays: 4,
        lastPracticeDate: '2026-03-01',
        totalPracticeMinutes: 42,
      },
      user: { displayName: 'Ana' },
    });
    expect(data.progress.streakDays).toBe(4);
    expect(data.progress.totalPracticeMinutes).toBe(42);
    expect(data.progress.lessons['fundamentos-1'].bestScore).toBe(90);
    expect(data.user.displayName).toBe('Ana');
  });

  it('corta o histórico que passou dos limites de sessões e diário', () => {
    const sessions = Array.from({ length: MAX_SESSIONS + 5 }, (_, i) => session({ id: `s${i}` }));
    const journal = Array.from({ length: MAX_JOURNAL + 3 }, (_, i) => entry(`j${i}`));
    const { data } = migrateData({ sessions, journal });
    expect(data.sessions).toHaveLength(MAX_SESSIONS);
    expect(data.journal).toHaveLength(MAX_JOURNAL);
    // corta os mais antigos: o último sempre fica
    expect(data.sessions.at(-1)?.id).toBe(`s${MAX_SESSIONS + 4}`);
  });
});

describe('sessões', () => {
  it('adiciona no fim e não muta o estado anterior', () => {
    const antes = createInitialData();
    const depois = addSession(antes, session());
    expect(antes.sessions).toHaveLength(0);
    expect(depois.sessions).toHaveLength(1);
  });

  it('mantém no máximo MAX_SESSIONS, descartando as mais antigas', () => {
    let data = createInitialData();
    for (let i = 0; i < MAX_SESSIONS + 2; i++) data = addSession(data, session({ id: `s${i}` }));
    expect(data.sessions).toHaveLength(MAX_SESSIONS);
    expect(data.sessions[0].id).toBe('s2');
  });

  it('atualiza só a sessão pedida, preservando o id', () => {
    const data = addSession(
      addSession(createInitialData(), session({ id: 'a' })),
      session({ id: 'b' }),
    );
    const out = updateSessionFeedback(data, 'b', {
      id: 'id-que-nao-deve-vencer',
      score: 95,
      feedback: [
        {
          id: 'metas-ok',
          severity: 'sucesso',
          title: 'melhorou',
          what: 'x',
          why: 'y',
          how: 'z',
          evidence: [],
        },
      ],
    });
    expect(out.sessions[1].id).toBe('b');
    expect(out.sessions[1].score).toBe(95);
    expect(out.sessions[1].feedback?.[0]?.id).toBe('metas-ok');
    expect(out.sessions[0].score).toBe(80);
    // id inexistente não muda nada
    expect(updateSessionFeedback(data, 'zzz', { score: 1 })).toEqual(data);
  });
});

describe('gravações', () => {
  it('adiciona e remove, limpando a referência nas sessões', () => {
    let data = addRecording(createInitialData(), recording('r1'));
    data = addSession(data, session({ recordingId: 'r1' }));
    expect(data.recordings).toHaveLength(1);

    const out = removeRecording(data, 'r1');
    expect(out.recordings).toHaveLength(0);
    expect(out.sessions[0].recordingId).toBeNull();
  });

  it('remover id inexistente é inofensivo', () => {
    const data = addRecording(createInitialData(), recording('r1'));
    expect(removeRecording(data, 'nada')).toEqual(data);
  });
});

describe('diário', () => {
  it('adiciona, atualiza e remove', () => {
    let data = addJournalEntry(createInitialData(), entry('j1'));
    expect(data.journal).toHaveLength(1);

    data = updateJournalEntry(data, entry('j1', { notes: 'editado' }));
    expect(data.journal[0].notes).toBe('editado');

    data = addJournalEntry(data, entry('j2'));
    data = removeJournalEntry(data, 'j1');
    expect(data.journal.map((j) => j.id)).toEqual(['j2']);
  });

  it('respeita MAX_JOURNAL descartando a nota mais antiga', () => {
    let data = createInitialData();
    for (let i = 0; i < MAX_JOURNAL + 2; i++) data = addJournalEntry(data, entry(`j${i}`));
    expect(data.journal).toHaveLength(MAX_JOURNAL);
    expect(data.journal[0].id).toBe('j2');
  });
});

describe('metas', () => {
  it('faz upsert: cria quando não existe, substitui quando existe', () => {
    let data = upsertGoal(createInitialData(), goal('g1'));
    expect(data.goals).toHaveLength(1);

    data = upsertGoal(data, goal('g1', { target: 200 }));
    expect(data.goals).toHaveLength(1);
    expect(data.goals[0].target).toBe(200);

    data = upsertGoal(data, goal('g2'));
    expect(data.goals.map((g) => g.id)).toEqual(['g1', 'g2']);

    expect(removeGoal(data, 'g1').goals.map((g) => g.id)).toEqual(['g2']);
  });
});

describe('recordLessonResult', () => {
  it('conta tentativas, guarda a melhor nota e conclui a aula no módulo', () => {
    let data = recordLessonResult(
      createInitialData(),
      makeLessonResult({
        lessonId: 'fundamentos-1',
        score: 70,
        completedAt: '2026-03-01T10:00:00.000Z',
      }),
      'fundamentos',
    );
    expect(data.progress.lessons['fundamentos-1']).toMatchObject({ attempts: 1, bestScore: 70 });

    data = recordLessonResult(
      data,
      makeLessonResult({
        lessonId: 'fundamentos-1',
        score: 55,
        completedAt: '2026-03-02T10:00:00.000Z',
      }),
      'fundamentos',
    );
    const lesson = data.progress.lessons['fundamentos-1'];
    expect(lesson.attempts).toBe(2);
    expect(lesson.bestScore).toBe(70); // nota menor não rebaixa a melhor
    expect(lesson.lastAt).toBe('2026-03-02T10:00:00.000Z');
    expect(data.progress.modules.fundamentos.completedLessons).toEqual(['fundamentos-1']);
  });

  it('não duplica a aula em completedLessons', () => {
    const result = makeLessonResult({
      lessonId: 'fundamentos-1',
      score: 80,
      completedAt: '2026-03-01T10:00:00.000Z',
    });
    let data = recordLessonResult(createInitialData(), result, 'fundamentos');
    data = recordLessonResult(data, result, 'fundamentos');
    expect(data.progress.modules.fundamentos.completedLessons).toEqual(['fundamentos-1']);
  });
});

describe('applyRetention', () => {
  const now = new Date('2026-03-31T00:00:00.000Z');

  const withRetention = (days: number) => {
    let data = createInitialData();
    data = {
      ...data,
      settings: { ...data.settings, privacy: { ...data.settings.privacy, retentionDays: days } },
    };
    data = addRecording(data, recording('velha', '2026-01-01T00:00:00.000Z'));
    data = addRecording(data, recording('nova', '2026-03-30T00:00:00.000Z'));
    return addSession(data, session({ id: 's-velha', recordingId: 'velha' }));
  };

  it('sem retenção configurada não remove nada', () => {
    const data = withRetention(0);
    const out = applyRetention(data, now);
    expect(out.removedRecordingIds).toEqual([]);
    expect(out.data).toBe(data);
  });

  it('remove o que passou do prazo e desvincula a sessão', () => {
    const out = applyRetention(withRetention(30), now);
    expect(out.removedRecordingIds).toEqual(['velha']);
    expect(out.data.recordings.map((r) => r.id)).toEqual(['nova']);
    expect(out.data.sessions[0].recordingId).toBeNull();
  });

  it('quando nada venceu, devolve o mesmo objeto', () => {
    const data = withRetention(3650);
    expect(applyRetention(data, now).data).toBe(data);
  });
});

describe('clearPersonalData e quickStats', () => {
  it('apaga conteúdo pessoal preservando as configurações', () => {
    let data = addSession(createInitialData(), session());
    data = addJournalEntry(data, entry('j1'));
    data = addRecording(data, recording('r1'));
    const settings = { ...data.settings, audio: { ...data.settings.audio, gainDb: 7 } };

    const out = clearPersonalData(settings);
    expect(out.sessions).toEqual([]);
    expect(out.journal).toEqual([]);
    expect(out.recordings).toEqual([]);
    expect(out.settings.audio.gainDb).toBe(7);
  });

  it('resume sessões, minutos, gravações e última sessão', () => {
    let data = createInitialData();
    data = addSession(data, session({ id: 'a', durationSec: 90, score: 60 }));
    data = addSession(
      data,
      session({ id: 'b', createdAt: '2026-03-02T10:00:00.000Z', durationSec: 30, score: 90 }),
    );
    data = addRecording(data, recording('r1'));

    const stats = quickStats(data);
    expect(stats.sessions).toBe(2);
    expect(stats.minutes).toBe(2);
    expect(stats.recordings).toBe(1);
    expect(stats.lastSessionAt).toBe('2026-03-02T10:00:00.000Z');
    expect(stats.avgScore).toBe(75);
  });

  it('banco vazio: média e última sessão nulas', () => {
    const stats = quickStats(createInitialData());
    expect(stats).toEqual({
      sessions: 0,
      minutes: 0,
      recordings: 0,
      lastSessionAt: null,
      avgScore: null,
    });
  });

  it('ignora sessões sem nota na média', () => {
    let data = addSession(createInitialData(), session({ id: 'a', score: 100 }));
    data = addSession(data, session({ id: 'b', score: undefined }));
    expect(quickStats(data).avgScore).toBe(100);
  });
});
