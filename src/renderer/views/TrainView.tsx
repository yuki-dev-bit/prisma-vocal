/**
 * Treinar: trilha progressiva + executor de exercícios com metas relativas.
 */
import { useEffect, useMemo, useState } from 'react';
import { useStore, useErrorBanner } from '../state/store';
import { useLiveSession } from '../state/useLiveSession';
import { modulesForMode, lessonById } from '../../core/training/curriculum';
import { moduleCompletion } from '../../core/training/progress';
import {
  contextFromMetrics,
  evaluateTargets,
  resolveTarget,
  scoreTargets,
  type TargetContext,
} from '../../core/training/evaluate';
import { generateFeedback } from '../../core/feedback/engine';
import { PitchRibbon } from '../components/hud/PitchRibbon';
import { LevelMeter } from '../components/hud/LevelMeter';
import { FeedbackList } from '../components/ui';
import {
  IconCheck,
  IconChevron,
  IconLock,
  IconPlay,
  IconStop,
  IconTarget,
} from '../components/Icons';
import { noteName } from '../../core/utils/math';
import type {
  FeedbackItem,
  LessonExercise,
  LessonResult,
  SessionRecord,
  TrainingModule,
} from '../../shared/types';

function baselineContext(data: ReturnType<typeof useStore>['data']): TargetContext {
  if (data.profile?.comfortableHz) {
    const lastResonance = [...data.sessions].reverse().find((s) => s.metrics.resonanceIndex > 0);
    return {
      baselineF0: data.profile.comfortableHz,
      baselineBrightness: lastResonance?.metrics.resonanceIndex ?? null,
      selfRangeSt: data.profile.rangeSt || null,
    };
  }
  const last = data.sessions.at(-1);
  return contextFromMetrics(last?.metrics ?? null);
}

export function TrainView({
  initialLessonId,
  onOpenAnalyze,
}: {
  initialLessonId?: string;
  onOpenAnalyze: () => void;
}) {
  const { data, settings, t, saveLessonResult, saveSession, pushBanner } = useStore();
  const reportError = useErrorBanner();
  const modules = useMemo(
    () => modulesForMode(settings.mode).sort((a, b) => a.order - b.order),
    [settings.mode],
  );
  const [lessonId, setLessonId] = useState<string>(
    initialLessonId ?? modules[0]?.lessons[0]?.id ?? '',
  );
  const [activeExercise, setActiveExercise] = useState<string | null>(null);
  const session = useLiveSession();

  useEffect(() => {
    if (initialLessonId) setLessonId(initialLessonId);
  }, [initialLessonId]);

  const lesson = lessonById(lessonId);
  const module = modules.find((m) => m.id === lesson?.moduleId) ?? null;
  const ctx = useMemo(() => baselineContext(data), [data]);
  const [exerciseResult, setExerciseResult] = useState<{
    exerciseId: string;
    score: number | null;
    outcomes: ReturnType<typeof evaluateTargets>;
    feedback: FeedbackItem[];
  } | null>(null);
  const [remaining, setRemaining] = useState(0);
  const [referenceHz, setReferenceHz] = useState<number | null>(null);

  /* contagem regressiva do exercício */
  useEffect(() => {
    if (session.status !== 'running' || !activeExercise) return;
    const duration = lesson?.exercises.find((e) => e.id === activeExercise)?.durationSec ?? 30;
    setRemaining(Math.max(0, Math.ceil(duration - session.elapsedSec)));
    if (session.elapsedSec >= duration) finishExercise();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.elapsedSec, session.status, activeExercise]);

  const startExercise = async (exercise: LessonExercise) => {
    setExerciseResult(null);
    setActiveExercise(exercise.id);
    if (exercise.needsReferencePitch && ctx.baselineF0) {
      const hz = ctx.baselineF0 * Math.pow(2, 1 / 12);
      setReferenceHz(hz);
      session.playTone(hz, 800);
    } else {
      setReferenceHz(null);
    }
    const ok = await session.start();
    if (!ok) {
      reportError(new Error(session.error ?? 'Falha ao iniciar a captura'), 'train.start');
      setActiveExercise(null);
    }
  };

  const finishExercise = () => {
    const exercise = lesson?.exercises.find((e) => e.id === activeExercise);
    if (!exercise || !lesson || !module) return;
    const res = session.stop({ speech: exercise.kind === 'leitura' || exercise.kind === 'fala' });
    setActiveExercise(null);
    if (!res) {
      pushBanner({ kind: 'warn', message: 'Nada foi capturado — verifique o microfone.' });
      return;
    }
    const outcomes = evaluateTargets(res.metrics, exercise.targets, ctx);
    const score = scoreTargets(outcomes) ?? 0;
    const feedback = generateFeedback({
      metrics: res.metrics,
      targets: outcomes,
      kind: exercise.kind,
      baseline: { f0: ctx.baselineF0, brightness: ctx.baselineBrightness },
      calibration: settings.audio.calibrationOffsetDb > 0,
    });
    setExerciseResult({
      exerciseId: exercise.id,
      score: scoreTargets(outcomes),
      outcomes,
      feedback,
    });

    const result: LessonResult = {
      lessonId: lesson.id,
      exerciseId: exercise.id,
      completedAt: new Date().toISOString(),
      score,
      metrics: res.metrics,
      targetsMet: outcomes.map((o) => ({ target: o.target, met: o.met, actual: o.actual })),
      feedbackIds: feedback.map((f) => f.id),
    };
    saveLessonResult(result, module.id);

    const record: SessionRecord = {
      id: `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      createdAt: result.completedAt,
      mode: settings.mode,
      kind: exercise.kind,
      lessonId: lesson.id,
      exerciseId: exercise.id,
      durationSec: res.durationSec,
      metrics: res.metrics,
      score,
      recordingId: null,
      feedback,
    };
    saveSession(record);
  };

  const completedLessons = module ? (data.progress.modules[module.id]?.completedLessons ?? []) : [];

  return (
    <div className="grid analyze side-narrow">
      <div className="stack">
        {lesson && module ? (
          <>
            <div className="card">
              <div className="row wrap" style={{ marginBottom: 'var(--sp-3)' }}>
                <span className="chip blue">{module.title}</span>
                <span className="chip">nível {lesson.level}</span>
                <span className="chip">{lesson.estimatedMinutes} min</span>
                {completedLessons.includes(lesson.id) && (
                  <span className="chip ok">
                    <IconCheck size={12} /> concluída
                  </span>
                )}
                <span className="spacer" />
                <span className="small faint mono">
                  {lesson.exercises.length} exercício{lesson.exercises.length > 1 ? 's' : ''}
                </span>
              </div>
              <h1 className="h1" style={{ fontSize: 'var(--fs-2xl)' }}>
                {lesson.title}
              </h1>
              <p className="lead" style={{ marginTop: 'var(--sp-2)' }}>
                {lesson.objective}
              </p>
              <div className="divider" />
              <div className="stack" style={{ gap: ' var(--sp-2)' }}>
                <span className="section-title">Por que isso importa</span>
                <p className="small muted" style={{ margin: 0 }}>
                  {lesson.why}
                </p>
              </div>
            </div>

            {lesson.exercises.map((ex, index) => {
              const running = activeExercise === ex.id && session.status === 'running';
              const showResult = exerciseResult?.exerciseId === ex.id;
              return (
                <div className="card" key={ex.id}>
                  <div className="card-header">
                    <span className="chip mono">{String(index + 1).padStart(2, '0')}</span>
                    <div style={{ flex: 1 }}>
                      <h3 className="card-title">{ex.title}</h3>
                      <p className="card-sub">
                        {ex.kind} · {ex.durationSec}s
                      </p>
                    </div>
                    {!running ? (
                      <button className="btn primary sm" onClick={() => void startExercise(ex)}>
                        <IconPlay className="btn-icon" /> {t('trainingStartExercise')}
                      </button>
                    ) : (
                      <button className="btn danger sm" onClick={finishExercise}>
                        <IconStop className="btn-icon" /> Parar ({remaining}s)
                      </button>
                    )}
                  </div>

                  <ol
                    className="small muted"
                    style={{ margin: '0 0 var(--sp-3)', paddingLeft: 20 }}
                  >
                    {ex.steps.map((s, i) => (
                      <li key={i} style={{ marginBottom: 4 }}>
                        {s}
                      </li>
                    ))}
                  </ol>

                  <div className="banner info" style={{ marginBottom: 'var(--sp-3)' }}>
                    <IconTarget size={15} />
                    <span>{ex.cue}</span>
                  </div>

                  {ex.targets.length > 0 && !showResult && (
                    <div className="row wrap" style={{ marginBottom: 'var(--sp-3)' }}>
                      {ex.targets.map((target, i) => {
                        const resolved = resolveTarget(target, ctx);
                        return (
                          <span key={i} className={`chip ${resolved.unresolved ? 'warn' : ''}`}>
                            {target.label}: <span className="mono">{resolved.display}</span>
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {running && (
                    <div className="stack" style={{ gap: 'var(--sp-2)' }}>
                      <LevelMeter
                        peak={session.readout.peak}
                        levelDb={session.readout.levelDb}
                        clipping={session.readout.clipping}
                      />
                      <PitchRibbon
                        buffer={session.buffer}
                        minHz={session.bounds.hudMin}
                        maxHz={session.bounds.hudMax}
                        targetHz={referenceHz}
                        reducedMotion={settings.ui.reducedMotion}
                        colorSafe={settings.ui.colorBlindSafe}
                      />
                      <div className="row">
                        <span className="chip mono">
                          {session.readout.f0
                            ? `${session.readout.f0.toFixed(1)} Hz · ${noteName(session.readout.f0)}`
                            : 'silêncio'}
                        </span>
                        <span className="chip mono">
                          ressonância {session.readout.voiced ? session.readout.resonance : '—'}/100
                        </span>
                        <span className="chip mono">
                          soprosidade{' '}
                          {session.readout.voiced
                            ? Math.round(session.readout.breathiness * 100)
                            : '—'}
                          /100
                        </span>
                        <span className="spacer" />
                        <span className="small faint">tempo restante {remaining}s</span>
                      </div>
                    </div>
                  )}

                  {showResult && exerciseResult && (
                    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
                      <div className="row wrap">
                        <span
                          className={`chip ${exerciseResult.score !== null && exerciseResult.score >= 70 ? 'ok' : 'warn'}`}
                        >
                          nota {exerciseResult.score ?? '—'}/100
                        </span>
                        {exerciseResult.outcomes.map((o, i) => (
                          <span key={i} className={`chip ${o.met ? 'ok' : ''}`}>
                            {o.met ? <IconCheck size={11} /> : '·'} {o.target.label}:{' '}
                            <span className="mono">{o.display}</span>
                            {o.actual !== null && (
                              <span className="faint">
                                {' '}
                                (medido {Math.round(o.actual * 10) / 10})
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                      <FeedbackList items={exerciseResult.feedback} />
                    </div>
                  )}

                  <details style={{ marginTop: 'var(--sp-3)' }}>
                    <summary className="small faint" style={{ cursor: 'pointer' }}>
                      {t('trainingPitfalls')}
                    </summary>
                    <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                      {ex.pitfalls.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </details>
                </div>
              );
            })}
          </>
        ) : (
          <div className="card">
            <p className="small muted">Selecione uma aula na trilha ao lado.</p>
          </div>
        )}
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-header">
            <div style={{ flex: 1 }}>
              <h3 className="card-title">Trilha</h3>
              <p className="card-sub">
                {t(
                  `mode${settings.mode === 'mtf' ? 'Mtf' : settings.mode === 'ftm' ? 'Ftm' : 'Shared'}` as never,
                )}
              </p>
            </div>
          </div>
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            {modules.map((m: TrainingModule) => (
              <div key={m.id}>
                <div className="row" style={{ marginBottom: 6 }}>
                  <span className="small" style={{ color: 'var(--text)', flex: 1 }}>
                    {m.title}
                  </span>
                  <span className="tiny mono faint">{moduleCompletion(data.progress, m)}%</span>
                </div>
                <div className="progress-track" style={{ marginBottom: 8 }}>
                  <span style={{ width: `${moduleCompletion(data.progress, m)}%` }} />
                </div>
                <div className="list">
                  {m.lessons.map((l) => {
                    const done = data.progress.modules[m.id]?.completedLessons.includes(l.id);
                    const locked =
                      (l.requires ?? []).length > 0 && !done && m.lessons[0].id !== l.id;
                    return (
                      <button
                        key={l.id}
                        className="list-item clickable"
                        style={{
                          textAlign: 'left',
                          borderColor: l.id === lessonId ? 'var(--border-strong)' : undefined,
                        }}
                        onClick={() => setLessonId(l.id)}
                      >
                        {done ? (
                          <IconCheck size={14} style={{ color: 'var(--ok)' }} />
                        ) : locked ? (
                          <IconLock size={14} style={{ color: 'var(--text-faint)' }} />
                        ) : (
                          <IconChevron size={14} style={{ color: 'var(--text-faint)' }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="list-title">{l.title}</div>
                          <div className="list-meta">
                            nível {l.level} · {l.estimatedMinutes} min
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Base das metas</h3>
          <p className="small muted" style={{ marginTop: 4 }}>
            {ctx.baselineF0
              ? `Linha de base: ${ctx.baselineF0.toFixed(0)} Hz (${noteName(ctx.baselineF0)}). Metas em semitons são calculadas sobre este valor.`
              : 'Sem linha de base: faça a avaliação inicial para ativar metas relativas.'}
          </p>
          {!ctx.baselineF0 && (
            <button className="btn sm" onClick={onOpenAnalyze} style={{ marginTop: 10 }}>
              Medir minha linha de base
            </button>
          )}
          {ctx.selfRangeSt && (
            <p className="hint">Extensão conhecida: {ctx.selfRangeSt.toFixed(1)} st</p>
          )}
        </div>
      </div>
    </div>
  );
}
