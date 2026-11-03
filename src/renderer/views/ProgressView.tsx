/** Progresso: evolução, metas e relatório exportável. */
import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { HistoryChart, EmptyState, Segmented } from '../components/ui';
import { IconChart, IconDownload, IconTarget, IconTrash } from '../components/Icons';
import { moduleSummary } from '../../core/training/recommender';
import { METRIC_LABEL, METRIC_UNIT, metricValue } from '../../core/training/evaluate';
import { suggestGoals } from '../../core/assessment/profile';
import { hzToSemitones, shortId } from '../../core/utils/math';
import type { Goal, MetricId } from '../../shared/types';

const CHART_METRICS: { id: MetricId; label: string; unit: string; color: string }[] = [
  { id: 'f0MedianHz', label: 'Altura mediana', unit: 'Hz', color: 'var(--blue)' },
  { id: 'f0Stability', label: 'Estabilidade de altura', unit: '/100', color: 'var(--mint)' },
  { id: 'resonanceIndex', label: 'Ressonância', unit: '/100', color: 'var(--pink)' },
  { id: 'hnrDb', label: 'Clareza (HNR)', unit: 'dB', color: 'var(--violet)' },
  { id: 'prosodySt', label: 'Melodia de fala', unit: 'st', color: 'var(--amber)' },
  { id: 'breathiness', label: 'Soprosidade', unit: '0–1', color: 'var(--warn)' },
];

export function ProgressView() {
  const { data, settings, saveGoal, deleteGoal, exportReport, t, pushBanner } = useStore();
  const [metric, setMetric] = useState<MetricId>('f0MedianHz');
  const [includeJournal, setIncludeJournal] = useState(true);
  const [includeGoals, setIncludeGoals] = useState(true);
  const [newGoal, setNewGoal] = useState<{
    title: string;
    metric: MetricId;
    target: number;
    note: string;
  } | null>(null);

  const sessionsSorted = useMemo(
    () => [...data.sessions].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [data.sessions],
  );

  const pointsFor = (id: MetricId) =>
    sessionsSorted.map((s) => ({ t: s.createdAt, value: metricValue(s.metrics, id) }));

  const f0SemitonePoints = useMemo(() => {
    const base =
      data.profile?.comfortableHz ??
      sessionsSorted.find((s) => s.metrics.f0MedianHz)?.metrics.f0MedianHz;
    if (!base) return [];
    return sessionsSorted.map((s) => ({
      t: s.createdAt,
      value: s.metrics.f0MedianHz
        ? Number((hzToSemitones(s.metrics.f0MedianHz) - hzToSemitones(base)).toFixed(2))
        : null,
    }));
  }, [data.profile, sessionsSorted]);

  const modules = moduleSummary(data.progress, settings.mode);
  const suggestions = data.profile ? suggestGoals(data.profile, settings.mode) : [];
  const chart = CHART_METRICS.find((c) => c.id === metric)!;

  const goalProgress = (goal: Goal): { current: number | null; pct: number; done: boolean } => {
    let current: number | null = null;
    for (let i = sessionsSorted.length - 1; i >= 0; i--) {
      const v = metricValue(sessionsSorted[i].metrics, goal.metric);
      if (v !== null && Number.isFinite(v)) {
        current = v;
        break;
      }
    }
    if (current === null) return { current: null, pct: 0, done: false };
    const baseline = goal.relativeTo === 'baseline' ? (goal.baselineValue ?? current) : 0;
    const span = goal.target - baseline;
    const pct = span === 0 ? 100 : Math.max(0, Math.min(100, ((current - baseline) / span) * 100));
    const done = span >= 0 ? current >= goal.target : current <= goal.target;
    return { current, pct, done };
  };

  return (
    <div className="stack">
      <div className="grid cols-2">
        <div className="card">
          <div className="card-header">
            <IconChart style={{ color: 'var(--blue)' }} />
            <div style={{ flex: 1 }}>
              <h3 className="card-title">Evolução</h3>
              <p className="card-sub">{sessionsSorted.length} sessões registradas</p>
            </div>
          </div>
          <Segmented
            ariaLabel="Métrica"
            value={metric}
            onChange={(v) => setMetric(v)}
            options={CHART_METRICS.map((c) => ({ id: c.id, label: c.label.split(' ')[0] }))}
          />
          <div style={{ marginTop: 'var(--sp-4)' }}>
            <HistoryChart
              points={pointsFor(metric)}
              label={chart.label}
              unit={chart.unit}
              color={chart.color}
            />
          </div>
          {data.profile?.comfortableHz && (
            <div style={{ marginTop: 'var(--sp-4)' }}>
              <HistoryChart
                points={f0SemitonePoints}
                label={`Altura relativa ao centro inicial (${data.profile.comfortableHz.toFixed(0)} Hz)`}
                unit="st"
                color="var(--pink)"
                height={120}
              />
              <p className="hint">
                Medir em semitons relativos evita comparar a sua voz com números de outra pessoa.
              </p>
            </div>
          )}
        </div>

        <div className="stack">
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
              Trilha
            </h3>
            <div className="stack" style={{ gap: 'var(--sp-3)' }}>
              {modules.map((m) => (
                <div key={m.id}>
                  <div className="row" style={{ marginBottom: 4 }}>
                    <span className="small" style={{ flex: 1 }}>
                      {m.title}
                    </span>
                    <span className="tiny mono faint">
                      {m.done}/{m.lessons}
                    </span>
                  </div>
                  <div className="progress-track">
                    <span style={{ width: `${m.completion}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="divider" />
            <div className="row">
              <span className="small muted" style={{ flex: 1 }}>
                {data.progress.streakDays}{' '}
                {data.progress.streakDays === 1 ? 'dia seguido' : 'dias seguidos'} ·{' '}
                {data.progress.totalPracticeMinutes > 0
                  ? `${data.progress.totalPracticeMinutes} min no total`
                  : data.sessions.length > 0
                    ? 'menos de 1 min no total'
                    : 'sem minutos registrados'}
              </span>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
              Relatório
            </h3>
            <p className="hint">
              Gera um arquivo local (HTML ou Markdown) com perfil, sessões, metas e evolução. Nada é
              enviado para servidores — o arquivo só existe onde você salvar.
            </p>
            <div className="stack" style={{ gap: 'var(--sp-2)', marginTop: 'var(--sp-3)' }}>
              <label className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={includeJournal}
                  onChange={(e) => setIncludeJournal(e.target.checked)}
                />
                <span className="small">Incluir diário vocal</span>
              </label>
              <label className="row" style={{ gap: 8 }}>
                <input
                  type="checkbox"
                  checked={includeGoals}
                  onChange={(e) => setIncludeGoals(e.target.checked)}
                />
                <span className="small">Incluir metas</span>
              </label>
              <button
                className="btn primary"
                onClick={() =>
                  void exportReport({ includeJournal, includeGoals, includeSessions: 20 })
                }
              >
                <IconDownload className="btn-icon" /> Exportar relatório
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <IconTarget style={{ color: 'var(--pink)' }} />
          <div style={{ flex: 1 }}>
            <h3 className="card-title">{t('goalsTitle')}</h3>
            <p className="card-sub">Metas são suas. Ajuste ou pause quando quiser.</p>
          </div>
          <button
            className="btn sm"
            onClick={() =>
              setNewGoal({
                title: '',
                metric: 'f0MedianHz',
                target: Math.round(data.profile?.comfortableHz ?? 150),
                note: '',
              })
            }
          >
            Nova meta
          </button>
        </div>

        {data.goals.length === 0 && suggestions.length > 0 && (
          <div className="banner info" style={{ marginBottom: 'var(--sp-3)' }}>
            <span>
              Sugestões do seu perfil: {suggestions.map((s) => s.title).join(' · ')} (você pode
              adicioná-las individualmente ou criar a sua).
            </span>
          </div>
        )}

        <div className="list">
          {data.goals.length === 0 && (
            <EmptyState
              title="Nenhuma meta"
              body="Crie uma meta para acompanhar um aspecto específico."
            />
          )}
          {data.goals.map((g) => {
            const prog = goalProgress(g);
            return (
              <div className="list-item" key={g.id} style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                    <span className="list-title">{g.title}</span>
                    <span className={`chip tiny ${prog.done ? 'ok' : ''}`}>
                      {prog.done ? 'atingida' : g.status}
                    </span>
                  </div>
                  <div className="list-meta">
                    {METRIC_LABEL[g.metric]} · alvo {g.target} {METRIC_UNIT[g.metric]} · atual{' '}
                    {prog.current === null ? '—' : prog.current.toFixed(1)}
                  </div>
                  <div
                    className="progress-track"
                    style={{ marginTop: 8, maxWidth: 380 }}
                    role="progressbar"
                    aria-valuenow={Math.round(prog.pct)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Progresso da meta ${g.title}`}
                  >
                    <span style={{ width: `${prog.pct}%` }} />
                  </div>
                  {g.note && (
                    <div className="hint" style={{ marginTop: 6 }}>
                      {g.note}
                    </div>
                  )}
                </div>
                <button
                  className="btn sm"
                  onClick={() =>
                    saveGoal({ ...g, status: g.status === 'ativa' ? 'pausada' : 'ativa' })
                  }
                >
                  {g.status === 'ativa' ? 'Pausar' : 'Retomar'}
                </button>
                <button
                  className="icon-btn"
                  onClick={() => deleteGoal(g.id)}
                  aria-label="Excluir meta"
                >
                  <IconTrash size={15} />
                </button>
              </div>
            );
          })}
        </div>

        {newGoal && (
          <div
            className="card"
            style={{ marginTop: 'var(--sp-4)', background: 'var(--surface-sunken)' }}
          >
            <h4 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
              Nova meta
            </h4>
            <div className="grid cols-2">
              <label className="field">
                <span className="label">Título</span>
                <input
                  type="text"
                  value={newGoal.title}
                  maxLength={120}
                  onChange={(e) => setNewGoal({ ...newGoal, title: e.target.value })}
                  placeholder="Ex.: falar 2 semitons acima com naturalidade"
                />
              </label>
              <label className="field">
                <span className="label">Métrica</span>
                <select
                  value={newGoal.metric}
                  onChange={(e) => setNewGoal({ ...newGoal, metric: e.target.value as MetricId })}
                >
                  {CHART_METRICS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="label">Alvo ({METRIC_UNIT[newGoal.metric]})</span>
                <input
                  type="number"
                  value={newGoal.target}
                  onChange={(e) => setNewGoal({ ...newGoal, target: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span className="label">Nota (opcional)</span>
                <input
                  type="text"
                  value={newGoal.note}
                  maxLength={200}
                  onChange={(e) => setNewGoal({ ...newGoal, note: e.target.value })}
                />
              </label>
            </div>
            <div className="row" style={{ marginTop: 'var(--sp-4)' }}>
              <button
                className="btn primary"
                disabled={!newGoal.title.trim() || !Number.isFinite(newGoal.target)}
                onClick={() => {
                  const current = sessionsSorted.at(-1);
                  saveGoal({
                    id: shortId('g_'),
                    title: newGoal.title.trim().slice(0, 120),
                    createdAt: new Date().toISOString(),
                    targetDate: null,
                    metric: newGoal.metric,
                    target: newGoal.target,
                    relativeTo: 'baseline',
                    baselineValue: current ? metricValue(current.metrics, newGoal.metric) : null,
                    status: 'ativa',
                    note: newGoal.note.slice(0, 200),
                  });
                  setNewGoal(null);
                  pushBanner({ kind: 'info', message: 'Meta criada.' });
                }}
              >
                {t('save')}
              </button>
              <button className="btn ghost" onClick={() => setNewGoal(null)}>
                {t('cancel')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
