/**
 * Estado global do aplicativo (React context + reducer-lite).
 *
 * Toda mutação passa pelo repositório puro (`@core/storage/repository`) e é
 * persistida pela bridge. O estado em memória é a única fonte para a UI;
 * o disco é uma cópia — assim uma falha de escrita nunca corrompe a sessão
 * em andamento (a UI mostra o erro e mantém os dados em memória).
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AppData,
  AppSettings,
  AssessmentRun,
  ComparisonResult,
  Goal,
  JournalEntry,
  LessonResult,
  RecordingMeta,
  SessionRecord,
  TrainingMode,
} from '../../shared/types';
import { getBridge, type StorageBridge } from './bridge';
import {
  addJournalEntry,
  addRecording,
  addSession,
  applyRetention,
  clearPersonalData,
  createInitialData,
  quickStats,
  recordLessonResult,
  removeGoal,
  removeJournalEntry,
  removeRecording,
  updateJournalEntry,
  upsertGoal,
} from '../../core/storage/repository';
import { sanitizeSettings } from '../../core/settings/defaults';
import { refreshDerived } from '../../core/training/progress';
import { recommendNext, type Recommendation } from '../../core/training/recommender';
import { compareSessions } from '../../core/analysis/compare';
import { buildHtmlReport, buildMarkdownReport } from '../../core/reports/report';
import { translator, type Locale, type TKey } from '../../core/i18n';
import type { SystemInfo } from '../../shared/ipc-contract';

export type Banner = {
  id: string;
  kind: 'info' | 'warn' | 'danger';
  message: string;
  action?: { label: string; run: () => void };
};

interface StoreValue {
  ready: boolean;
  data: AppData;
  settings: AppSettings;
  bridge: StorageBridge;
  issues: string[];
  banners: Banner[];
  system: SystemInfo | null;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
  locale: Locale;
  recommendation: Recommendation | null;
  stats: ReturnType<typeof quickStats>;
  dismissBanner: (id: string) => void;
  pushBanner: (b: Omit<Banner, 'id'>) => void;
  setMode: (mode: TrainingMode) => void;
  /**
   * `immediate` grava no disco sem esperar o debounce — usado em mudanças que o
   * usuário considera "configuração concluída" (calibração, remoção de dados).
   */
  updateSettings: (patch: DeepPartial<AppSettings>, opts?: { immediate?: boolean }) => void;
  saveSession: (session: SessionRecord) => void;
  saveAssessment: (run: AssessmentRun) => void;
  saveLessonResult: (result: LessonResult, moduleId: string) => void;
  saveRecording: (
    meta: RecordingMeta,
    pcm: Float32Array,
    sampleRate: number,
  ) => Promise<string | null>;
  deleteRecording: (id: string) => Promise<void>;
  loadRecording: (id: string) => Promise<Float32Array | null>;
  exportRecordingWav: (id: string) => Promise<void>;
  addJournal: (entry: JournalEntry) => void;
  editJournal: (entry: JournalEntry) => void;
  deleteJournal: (id: string) => void;
  saveGoal: (goal: Goal) => void;
  deleteGoal: (id: string) => void;
  compare: (aId: string, bId: string) => ComparisonResult | null;
  exportReport: (opts: {
    includeJournal: boolean;
    includeSessions: number;
    includeGoals: boolean;
  }) => Promise<void>;
  exportBackup: () => Promise<void>;
  importBackup: () => Promise<void>;
  clearAll: () => Promise<void>;
  openExternal: (url: string) => void;
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

const StoreContext = createContext<StoreValue | null>(null);

const ERROR_BANNER_ID = 'erro';

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const bridge = useMemo(() => getBridge(), []);
  const [data, setData] = useState<AppData>(() => createInitialData());
  const [ready, setReady] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [banners, setBanners] = useState<Banner[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const hydrated = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const dataRef = useRef<AppData>(data);
  const immediateSave = useRef(false);
  dataRef.current = data;

  const pushBanner = useCallback((b: Omit<Banner, 'id'>) => {
    const id = b.message.slice(0, 40);
    setBanners((prev) => {
      if (prev.some((p) => p.id === id)) return prev;
      return [...prev, { ...b, id }];
    });
    // Avisos informativos desaparecem sozinhos; os de risco ficam até serem lidos.
    if (b.kind === 'info') {
      window.setTimeout(() => {
        setBanners((prev) => prev.filter((x) => x.id !== id));
      }, 6000);
    }
  }, []);

  const dismissBanner = useCallback((id: string) => {
    setBanners((prev) => prev.filter((b) => b.id !== id));
  }, []);

  /* ----------------------------- carregamento ----------------------------- */

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await bridge.loadData();
        if (cancelled) return;
        setData(res.data);
        setIssues(res.issues);
        const extra = res.warnings.map((message) => ({
          id: message.slice(0, 30),
          kind: 'info' as const,
          message,
        }));
        setBanners((prev) => [...prev, ...extra]);
        const sys = await bridge.systemInfo();
        if (!cancelled) setSystem(sys);
      } catch (err) {
        pushBanner({
          kind: 'danger',
          message: `Não foi possível carregar seus dados: ${(err as Error).message}`,
        });
      } finally {
        if (!cancelled) {
          hydrated.current = true;
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bridge, pushBanner]);

  /* ----------------------------- persistência ----------------------------- */

  const flushAsync = useCallback(
    async (state: AppData): Promise<void> => {
      if (!hydrated.current) return;
      const res = await bridge.saveData(state);
      if (!res.ok) {
        pushBanner({ kind: 'danger', message: res.error ?? 'Falha ao salvar os dados.' });
      }
    },
    [bridge, pushBanner],
  );

  const flush = useCallback((state: AppData) => void flushAsync(state), [flushAsync]);

  /**
   * Fechamento da janela no desktop: o processo principal pede a descarga e
   * espera a confirmação antes de destruir o renderer. Sem isso, a última
   * alteração (dentro dos 450 ms do debounce) se perdia ao fechar o app.
   */
  useEffect(() => {
    if (!bridge.onFlushRequest) return;
    return bridge.onFlushRequest(() => flushAsync(dataRef.current));
  }, [bridge, flushAsync]);

  useEffect(() => {
    if (!hydrated.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    if (immediateSave.current) {
      // Mudanças marcadas como críticas não passam pelo debounce: se o usuário
      // fecha o app logo depois de salvar a calibração, o valor já está no disco.
      immediateSave.current = false;
      flush(data);
      return;
    }
    saveTimer.current = window.setTimeout(() => flush(data), 450);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [data, flush]);

  /**
   * Descarga ao sair da tela/app. No Android o WebView é pausado em segundo
   * plano e `beforeunload` NÃO dispara quando o sistema mata o processo; por
   * isso escutamos também `pagehide` e `visibilitychange` — sem isso, a última
   * alteração (feita há menos de 450 ms) podia se perder ao fechar o app.
   */
  useEffect(() => {
    const flushNow = () => flush(dataRef.current);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    window.addEventListener('beforeunload', flushNow);
    window.addEventListener('pagehide', flushNow);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('beforeunload', flushNow);
      window.removeEventListener('pagehide', flushNow);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [flush]);

  /* ----------------------------- lembretes ----------------------------- */

  useEffect(() => {
    if (!ready) return;
    void bridge.setReminders(data.settings.reminders);
    const off = bridge.onReminder(() => {
      pushBanner({
        kind: 'info',
        message: data.settings.reminders.message || 'Hora de praticar sua voz.',
      });
    });
    return off;
  }, [bridge, data.settings.reminders, pushBanner, ready]);

  /* ----------------------------- retenção ----------------------------- */

  useEffect(() => {
    if (!ready) return;
    const { data: pruned, removedRecordingIds } = applyRetention(data);
    if (removedRecordingIds.length > 0) {
      setData(pruned);
      for (const id of removedRecordingIds) void bridge.deleteRecording(id);
      pushBanner({
        kind: 'info',
        message: `${removedRecordingIds.length} gravação(ões) antiga(s) apagada(s) pela política de retenção.`,
      });
    }
    // roda apenas na inicialização
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  /* ----------------------------- ações ----------------------------- */

  const setMode = useCallback((mode: TrainingMode) => {
    setData((d) => ({ ...d, settings: { ...d.settings, mode } }));
  }, []);

  const updateSettings = useCallback(
    (patch: DeepPartial<AppSettings>, opts?: { immediate?: boolean }) => {
      if (opts?.immediate) immediateSave.current = true;
      setData((d) => {
        const merged = {
          ...d.settings,
          ...patch,
          audio: { ...d.settings.audio, ...(patch.audio ?? {}) },
          ui: { ...d.settings.ui, ...(patch.ui ?? {}) },
          privacy: { ...d.settings.privacy, ...(patch.privacy ?? {}) },
          reminders: { ...d.settings.reminders, ...(patch.reminders ?? {}) },
        };
        const { settings } = sanitizeSettings(merged);
        return { ...d, settings };
      });
    },
    [],
  );

  const saveSession = useCallback((session: SessionRecord) => {
    setData((d) => {
      const next = addSession(d, session);
      return { ...next, progress: refreshDerived(next.progress, next.sessions) };
    });
  }, []);

  const saveAssessment = useCallback((run: AssessmentRun) => {
    setData((d) => ({ ...d, assessment: run, profile: run.profile ?? d.profile }));
  }, []);

  const saveLessonResult = useCallback((result: LessonResult, moduleId: string) => {
    setData((d) => recordLessonResult(d, result, moduleId));
  }, []);

  const saveRecording = useCallback(
    async (meta: RecordingMeta, pcm: Float32Array, sampleRate: number): Promise<string | null> => {
      const res = await bridge.saveRecording(meta, pcm, sampleRate);
      if (!res.ok) {
        pushBanner({ kind: 'danger', message: res.error ?? 'Falha ao salvar gravação.' });
        return null;
      }
      setData((d) => addRecording(d, meta));
      return meta.id;
    },
    [bridge, pushBanner],
  );

  const deleteRecording = useCallback(
    async (id: string) => {
      const res = await bridge.deleteRecording(id);
      if (!res.ok)
        pushBanner({ kind: 'danger', message: res.error ?? 'Falha ao excluir gravação.' });
      setData((d) => removeRecording(d, id));
    },
    [bridge, pushBanner],
  );

  const loadRecording = useCallback(
    async (id: string) => {
      const res = await bridge.loadRecording(id);
      if (!res.ok || !res.data) {
        pushBanner({ kind: 'danger', message: res.error ?? 'Gravação indisponível.' });
        return null;
      }
      return res.data;
    },
    [bridge, pushBanner],
  );

  const exportRecordingWav = useCallback(
    async (id: string) => {
      const meta = data.recordings.find((r) => r.id === id);
      if (!meta) return;
      const res = await bridge.exportRecordingWav(
        id,
        meta.sampleRate,
        `prisma-${meta.createdAt.slice(0, 10)}`,
      );
      if (!res.ok) pushBanner({ kind: 'warn', message: res.error ?? 'Exportação não concluída.' });
      else pushBanner({ kind: 'info', message: `Gravação exportada: ${res.data?.path ?? ''}` });
    },
    [bridge, data.recordings, pushBanner],
  );

  const addJournal = useCallback(
    (entry: JournalEntry) => setData((d) => addJournalEntry(d, entry)),
    [],
  );
  const editJournal = useCallback(
    (entry: JournalEntry) => setData((d) => updateJournalEntry(d, entry)),
    [],
  );
  const deleteJournal = useCallback((id: string) => setData((d) => removeJournalEntry(d, id)), []);
  const saveGoal = useCallback((goal: Goal) => setData((d) => upsertGoal(d, goal)), []);
  const deleteGoal = useCallback((id: string) => setData((d) => removeGoal(d, id)), []);

  const compare = useCallback(
    (aId: string, bId: string): ComparisonResult | null => {
      const a = data.recordings.find((r) => r.id === aId)?.metrics;
      const b = data.recordings.find((r) => r.id === bId)?.metrics;
      if (!a || !b) return null;
      return compareSessions(a, b);
    },
    [data.recordings],
  );

  const exportReport = useCallback(
    async (opts: { includeJournal: boolean; includeSessions: number; includeGoals: boolean }) => {
      const markdown = buildMarkdownReport(data, opts);
      const html = buildHtmlReport(data, opts);
      const res = await bridge.exportReport({
        html,
        markdown,
        suggestedName: `prisma-relatorio-${new Date().toISOString().slice(0, 10)}.html`,
      });
      if (!res.ok) pushBanner({ kind: 'warn', message: res.error ?? 'Relatório não foi salvo.' });
      else pushBanner({ kind: 'info', message: `Relatório salvo em ${res.data?.path ?? ''}` });
    },
    [bridge, data, pushBanner],
  );

  const exportBackup = useCallback(async () => {
    const res = await bridge.exportBackup(data);
    if (!res.ok) pushBanner({ kind: 'warn', message: res.error ?? 'Backup não foi salvo.' });
    else pushBanner({ kind: 'info', message: `Backup salvo em ${res.data?.path ?? ''}` });
  }, [bridge, data, pushBanner]);

  const importBackup = useCallback(async () => {
    const res = await bridge.importBackup();
    if (!res.ok || !res.data) {
      pushBanner({ kind: 'warn', message: res.error ?? 'Backup não importado.' });
      return;
    }
    setData(res.data.data);
    pushBanner({
      kind: 'info',
      message: 'Backup importado. Gravações antigas não são restauradas (apenas dados).',
    });
  }, [bridge, pushBanner]);

  const clearAll = useCallback(async () => {
    const res = await bridge.clearAllData();
    if (!res.ok) {
      pushBanner({ kind: 'warn', message: res.error ?? 'Não foi possível apagar tudo.' });
      return;
    }
    const settings = data.settings;
    const fresh = clearPersonalData(settings);
    setData(fresh);
    await bridge.saveData(fresh);
    pushBanner({
      kind: 'info',
      message: 'Todos os dados pessoais foram apagados deste dispositivo.',
    });
  }, [bridge, data.settings, pushBanner]);

  const openExternal = useCallback(
    (url: string) => {
      void bridge.openExternal(url);
    },
    [bridge],
  );

  /* ----------------------------- derivados ----------------------------- */

  const locale: Locale = data.settings.ui.language;
  const t = useMemo(() => translator(locale), [locale]);
  const recommendation = useMemo(
    () =>
      recommendNext({
        progress: data.progress,
        mode: data.settings.mode,
        profile: data.profile,
        sessions: data.sessions,
      }),
    [data.progress, data.settings.mode, data.profile, data.sessions],
  );
  const stats = useMemo(() => quickStats(data), [data]);

  const value: StoreValue = {
    ready,
    data,
    settings: data.settings,
    bridge,
    issues,
    banners,
    system,
    t,
    locale,
    recommendation,
    stats,
    dismissBanner,
    pushBanner,
    setMode,
    updateSettings,
    saveSession,
    saveAssessment,
    saveLessonResult,
    saveRecording,
    deleteRecording,
    loadRecording,
    exportRecordingWav,
    addJournal,
    editJournal,
    deleteJournal,
    saveGoal,
    deleteGoal,
    compare,
    exportReport,
    exportBackup,
    importBackup,
    clearAll,
    openExternal,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore deve ser usado dentro de StoreProvider');
  return ctx;
}

export function useErrorBanner(): (err: unknown, context?: string) => void {
  const { pushBanner, bridge } = useStore();
  return useCallback(
    (err: unknown, context?: string) => {
      const message = err instanceof Error ? err.message : String(err);
      pushBanner({ kind: 'danger', message });
      void bridge.logError({
        message,
        stack: err instanceof Error ? err.stack : undefined,
        context,
      });
    },
    [pushBanner, bridge],
  );
}

export { ERROR_BANNER_ID };
