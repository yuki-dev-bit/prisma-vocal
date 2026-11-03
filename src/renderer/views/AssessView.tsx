/**
 * Avaliação inicial guiada (7 etapas) → perfil vocal + sugestão de metas.
 */
import { useMemo, useState } from 'react';
import { useStore, useErrorBanner } from '../state/store';
import { useLiveSession } from '../state/useLiveSession';
import {
  ASSESSMENT_PROTOCOL,
  RANGE_LABEL_TEXT,
  buildProfile,
  suggestGoals,
} from '../../core/assessment/profile';
import { METRIC_LABEL, METRIC_UNIT } from '../../core/training/evaluate';
import { PitchRibbon } from '../components/hud/PitchRibbon';
import { LevelMeter } from '../components/hud/LevelMeter';
import { IconCheck, IconChevron, IconPlay, IconStop, IconTarget } from '../components/Icons';
import { noteName, shortId } from '../../core/utils/math';
import type {
  AssessmentRun,
  AssessmentStepId,
  AssessmentStepResult,
  Goal,
} from '../../shared/types';

export function AssessView({ onDone }: { onDone: () => void }) {
  const { data, settings, saveAssessment, saveGoal, pushBanner, t } = useStore();
  const reportError = useErrorBanner();
  const session = useLiveSession();
  const [stepIndex, setStepIndex] = useState(0);
  const [results, setResults] = useState<AssessmentStepResult[]>([]);
  const [framesByStep, setFramesByStep] = useState<
    Partial<Record<AssessmentStepId, { t: number; f0: number | null; f0Confidence: number }[]>>
  >({});
  const [finished, setFinished] = useState(false);
  const [running, setRunning] = useState(false);

  const step = ASSESSMENT_PROTOCOL[Math.min(stepIndex, ASSESSMENT_PROTOCOL.length - 1)];
  const progressPct = Math.round((results.length / ASSESSMENT_PROTOCOL.length) * 100);
  const remaining = running
    ? Math.max(0, Math.ceil(step.durationSec - session.elapsedSec))
    : step.durationSec;

  const profileResult = useMemo(() => {
    if (!finished) return null;
    return buildProfile({ steps: results, mode: settings.mode, framesByStep });
  }, [finished, results, settings.mode, framesByStep]);

  const startStep = async () => {
    setRunning(true);
    const ok = await session.start();
    if (!ok) {
      setRunning(false);
      reportError(new Error(session.error ?? 'Falha ao iniciar a captura'), 'assess.start');
    }
  };

  const captureStep = () => {
    const res = session.stop({ speech: step.kind === 'fala' });
    setRunning(false);
    if (!res) {
      pushBanner({ kind: 'warn', message: 'Nada capturado nesta etapa. Tente novamente.' });
      return;
    }
    const noteMap: Record<AssessmentStepId, string> = {
      'fala-natural': `${res.metrics.prosodySt.toFixed(1)} st de variação melódica; centro em ${res.metrics.f0MedianHz?.toFixed(0) ?? '—'} Hz.`,
      'vogal-confortavel': `HNR ${res.metrics.hnrMedianDb?.toFixed(1) ?? '—'} dB; estabilidade ${res.metrics.f0Stability}/100.`,
      'glissando-descida': `piso detectado em ${res.metrics.f0P5Hz?.toFixed(0) ?? '—'} Hz.`,
      'glissando-subida': `teto detectado em ${res.metrics.f0P95Hz?.toFixed(0) ?? '—'} Hz.`,
      'ressonancia-escura': `ressonância ${res.metrics.resonanceIndex}/100 (escuro).`,
      'ressonancia-clara': `ressonância ${res.metrics.resonanceIndex}/100 (claro).`,
      'controle-altura': `desvio de ${res.metrics.pitchDriftSt ?? '—'} st em relação à nota sustentada.`,
    };
    const result: AssessmentStepResult = {
      stepId: step.id,
      recordedAt: new Date().toISOString(),
      durationSec: res.durationSec,
      metrics: res.metrics,
      note: noteMap[step.id],
    };
    setResults((prev) => [...prev.filter((r) => r.stepId !== step.id), result]);
    setFramesByStep((prev) => ({
      ...prev,
      [step.id]: res.frames.map((f) => ({ t: f.t, f0: f.f0, f0Confidence: f.f0Confidence })),
    }));

    if (stepIndex + 1 >= ASSESSMENT_PROTOCOL.length) {
      finish([...results.filter((r) => r.stepId !== step.id), result], {
        ...framesByStep,
        [step.id]: res.frames.map((f) => ({ t: f.t, f0: f.f0, f0Confidence: f.f0Confidence })),
      });
    } else {
      setStepIndex(stepIndex + 1);
    }
  };

  const finish = (allResults: AssessmentStepResult[], frames: typeof framesByStep) => {
    const { profile } = buildProfile({
      steps: allResults,
      mode: settings.mode,
      framesByStep: frames,
    });
    const run: AssessmentRun = {
      id: shortId('a_'),
      startedAt: allResults[0]?.recordedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      mode: settings.mode,
      steps: allResults,
      profile,
    };
    saveAssessment(run);
    setFinished(true);
  };

  const acceptGoal = (suggestion: ReturnType<typeof suggestGoals>[number]) => {
    const goal: Goal = {
      id: shortId('g_'),
      title: suggestion.title,
      createdAt: new Date().toISOString(),
      targetDate: null,
      metric: suggestion.metric,
      target: suggestion.target,
      relativeTo: suggestion.relativeTo,
      baselineValue: profileResult?.profile.comfortableHz ?? null,
      status: 'ativa',
      note: suggestion.rationale,
    };
    saveGoal(goal);
    pushBanner({ kind: 'info', message: 'Meta adicionada em Progresso.' });
  };

  if (finished && profileResult) {
    const p = profileResult.profile;
    const suggestions = suggestGoals(p, settings.mode);
    return (
      <div className="stack">
        <div className="card">
          <div className="row wrap" style={{ marginBottom: 'var(--sp-3)' }}>
            <span className="chip ok">
              <IconCheck size={12} /> avaliação concluída
            </span>
            <span className="chip">{RANGE_LABEL_TEXT[p.rangeLabel]}</span>
            <span className="chip">extensão {p.rangeSt.toFixed(1)} st</span>
          </div>
          <h1 className="h1">{t('assessResultTitle')}</h1>
          <p className="lead" style={{ marginTop: 'var(--sp-2)' }}>
            Estes valores descrevem sua voz <strong>hoje</strong>. Eles definem proporções para os
            exercícios — não são padrões que você precisa atingir.
          </p>

          <div className="grid cols-4" style={{ marginTop: 'var(--sp-5)' }}>
            {[
              { label: 'piso', hz: p.floorHz },
              { label: 'centro confortável', hz: p.comfortableHz },
              { label: 'teto', hz: p.ceilingHz },
              { label: 'posição do centro', hz: null, extra: `${p.centerPosition}%` },
            ].map((s) => (
              <div className="metric-card" key={s.label}>
                <span className="metric-name">{s.label}</span>
                <span className="metric-value" style={{ fontSize: 'var(--fs-xl)' }}>
                  {s.hz ? Math.round(s.hz) : s.extra}
                  {s.hz && <span className="readout-unit">Hz</span>}
                </span>
                <span className="hint">
                  {s.hz ? noteName(s.hz) : 'onde a voz fala entre piso e teto'}
                </span>
              </div>
            ))}
          </div>

          {profileResult.notes.length > 0 && (
            <div className="banner info" style={{ marginTop: 'var(--sp-4)' }}>
              <span>{profileResult.notes.join(' ')}</span>
            </div>
          )}
        </div>

        <div className="grid cols-2">
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
              O que já está bem
            </h3>
            {p.strengths.length ? (
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                {p.strengths.map((s, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    {s}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">
                Nada marcante nesta primeira medição — normal em um primeiro contato.
              </p>
            )}
          </div>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
              Onde há espaço para treinar
            </h3>
            {p.challenges.length ? (
              <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                {p.challenges.map((s, i) => (
                  <li key={i} style={{ marginBottom: 6 }}>
                    {s}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">
                Nenhum ponto de atenção evidente. Você pode aumentar a dificuldade dos exercícios.
              </p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <IconTarget style={{ color: 'var(--blue)' }} />
            <div style={{ flex: 1 }}>
              <h3 className="card-title">Metas sugeridas (opcionais)</h3>
              <p className="card-sub">
                Cada sugestão é uma proposta baseada no seu perfil — você decide o que faz sentido.
              </p>
            </div>
          </div>
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {suggestions.map((s, i) => {
              const exists = data.goals.some((g) => g.title === s.title);
              return (
                <div className="list-item" key={i}>
                  <div style={{ flex: 1 }}>
                    <div className="list-title">{s.title}</div>
                    <div className="list-meta">{s.rationale}</div>
                  </div>
                  <span className="chip mono">
                    {METRIC_LABEL[s.metric]} ·{' '}
                    {s.relativeTo === 'baseline' ? 'relativo' : 'absoluto'} {Math.round(s.target)}{' '}
                    {METRIC_UNIT[s.metric]}
                  </span>
                  <button className="btn sm" disabled={exists} onClick={() => acceptGoal(s)}>
                    {exists ? 'já adicionada' : 'adicionar'}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: 'var(--sp-4)' }}>
            <button className="btn primary" onClick={onDone}>
              Ir para o treino <IconChevron className="btn-icon" />
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setFinished(false);
                setResults([]);
                setFramesByStep({});
                setStepIndex(0);
              }}
            >
              {t('assessRestart')}
            </button>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
            Detalhe por etapa
          </h3>
          <div className="list">
            {results.map((r) => (
              <div className="list-item" key={r.stepId}>
                <span className="chip mono">{r.stepId}</span>
                <div style={{ flex: 1 }}>
                  <div className="list-title">{r.note}</div>
                  <div className="list-meta">
                    {r.durationSec.toFixed(1)} s · {r.metrics.frames} quadros ·{' '}
                    {r.metrics.qualityFlags.length
                      ? `avisos: ${r.metrics.qualityFlags.join(', ')}`
                      : 'captura limpa'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid analyze">
      <div className="stack">
        <div className="card">
          <div className="row wrap" style={{ marginBottom: 'var(--sp-3)' }}>
            <span className="chip blue">
              etapa {Math.min(stepIndex + 1, ASSESSMENT_PROTOCOL.length)} de{' '}
              {ASSESSMENT_PROTOCOL.length}
            </span>
            <span className="chip">{Math.round(progressPct)}% concluído</span>
            <span className="spacer" />
            <span className="small faint">≈ 4 minutos no total</span>
          </div>
          <div className="progress-track" style={{ marginBottom: 'var(--sp-4)' }}>
            <span style={{ width: `${progressPct}%` }} />
          </div>

          <h1 className="h1" style={{ fontSize: 'var(--fs-xl)' }}>
            {step.title}
          </h1>
          <p className="lead" style={{ marginTop: 'var(--sp-2)' }}>
            {step.instruction}
          </p>
          <div className="banner info" style={{ marginTop: 'var(--sp-4)' }}>
            <IconTarget size={15} />
            <span>{step.rationale}</span>
          </div>

          <div className="row wrap" style={{ marginTop: 'var(--sp-4)' }}>
            {!running ? (
              <button className="btn primary" onClick={() => void startStep()}>
                <IconPlay className="btn-icon" /> Gravar etapa ({step.durationSec}s)
              </button>
            ) : (
              <button className="btn danger" onClick={captureStep}>
                <IconStop className="btn-icon" /> Concluir etapa ({remaining}s)
              </button>
            )}
            <button
              className="btn ghost"
              onClick={() => setStepIndex(Math.min(stepIndex + 1, ASSESSMENT_PROTOCOL.length - 1))}
              disabled={running}
            >
              Pular etapa
            </button>
            <span className="chip">{step.hint}</span>
          </div>
        </div>

        {running && (
          <div className="card">
            <LevelMeter
              peak={session.readout.peak}
              levelDb={session.readout.levelDb}
              clipping={session.readout.clipping}
            />
            <PitchRibbon
              buffer={session.buffer}
              minHz={session.bounds.hudMin}
              maxHz={session.bounds.hudMax}
              reducedMotion={settings.ui.reducedMotion}
              colorSafe={settings.ui.colorBlindSafe}
            />
            <div className="row" style={{ marginTop: 'var(--sp-2)' }}>
              <span className="chip mono">
                {session.readout.f0 ? `${session.readout.f0.toFixed(1)} Hz` : 'silêncio'}
              </span>
              <span className="chip mono">nível {session.readout.levelDb.toFixed(0)} dBFS</span>
              <span className="spacer" />
              <span className="small faint">restam {remaining}s</span>
            </div>
          </div>
        )}

        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
            Etapas
          </h3>
          <div className="list">
            {ASSESSMENT_PROTOCOL.map((s, i) => {
              const done = results.some((r) => r.stepId === s.id);
              return (
                <div
                  className={`list-item ${i === stepIndex ? 'clickable' : ''}`}
                  key={s.id}
                  style={{ borderColor: i === stepIndex ? 'var(--border-strong)' : undefined }}
                >
                  {done ? (
                    <IconCheck size={14} style={{ color: 'var(--ok)' }} />
                  ) : (
                    <span className="chip mono tiny">{i + 1}</span>
                  )}
                  <div style={{ flex: 1 }}>
                    <div className="list-title">{s.title}</div>
                    <div className="list-meta">
                      {results.find((r) => r.stepId === s.id)?.note ??
                        s.instruction.slice(0, 72) + '…'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {results.length === ASSESSMENT_PROTOCOL.length && (
            <button
              className="btn primary"
              style={{ marginTop: 'var(--sp-4)' }}
              onClick={() => finish(results, framesByStep)}
            >
              Ver resultado
            </button>
          )}
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <h3 className="card-title">{t('assessIntroTitle')}</h3>
          <p className="small muted" style={{ marginTop: 6 }}>
            {t('assessIntroBody')}
          </p>
          <div className="divider" />
          <p className="hint">
            Nenhuma etapa exige uma nota específica. Tudo é medido em relação ao seu próprio chão e
            teto — vozes muito graves e muito agudas recebem o mesmo tratamento.
          </p>
        </div>
        <div className="card">
          <h3 className="card-title">Antes de começar</h3>
          <ul className="small muted" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
            <li style={{ marginBottom: 6 }}>
              Use fones, se possível — evita realimentação com o monitoramento.
            </li>
            <li style={{ marginBottom: 6 }}>
              Fique a um palmo do microfone e confira o nível entre −24 e −12 dBFS.
            </li>
            <li style={{ marginBottom: 6 }}>
              Se houver dor ou rouquidão, pare. Voz não é prova de resistência.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
