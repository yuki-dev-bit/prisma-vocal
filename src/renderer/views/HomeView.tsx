/** Início: próximo passo, estado atual da voz, atalhos. */
import { useState } from 'react';
import { useStore } from '../state/store';
import {
  IconArrowRight,
  IconFlame,
  IconLock,
  IconMic,
  IconSparkle,
  IconTarget,
  IconWave,
} from '../components/Icons';
import { CalibrationDialog } from '../components/CalibrationDialog';
import { RANGE_LABEL_TEXT } from '../../core/assessment/profile';
import { moduleSummary } from '../../core/training/recommender';
import { noteName } from '../../core/utils/math';
import { APP_VERSION } from '../../shared/version';
import type { ViewId } from '../App';

export function HomeView({
  onNavigate,
}: {
  onNavigate: (view: ViewId, lessonId?: string) => void;
}) {
  const { data, t, recommendation, stats, settings, updateSettings } = useStore();
  const [calibrating, setCalibrating] = useState(false);
  // Convite de calibração: aparece até o usuário calibrar ou dizer "agora não".
  const needsCalibration =
    settings.audio.calibrationOffsetDb === 0 && !settings.audio.calibrationPromptDismissed;
  const profile = data.profile;
  const modules = moduleSummary(data.progress, settings.mode);
  const activeGoals = data.goals.filter((g) => g.status === 'ativa');

  return (
    <div className="stack">
      <header className="stack" style={{ gap: 'var(--sp-3)' }}>
        <div className="row wrap">
          {/* versão do app (APP_VERSION), não a do schema de dados: eram
              confundidas antes e a tela mostrava v1.0 com o app em 1.0.0 */}
          <span className="chip blue">v{APP_VERSION} · offline</span>
          {data.progress.streakDays > 0 && (
            <span className="chip pink">
              <IconFlame size={13} /> {data.progress.streakDays}{' '}
              {data.progress.streakDays === 1 ? 'dia seguido' : 'dias seguidos'}
            </span>
          )}
          {profile && <span className="chip">{RANGE_LABEL_TEXT[profile.rangeLabel]}</span>}
        </div>
        <h1 className="h1">
          {data.user.displayName
            ? `Olá, ${data.user.displayName.split(' ')[0]}.`
            : 'Sua voz, com dados seus.'}
        </h1>
        <p className="lead">
          Treino guiado, análise acústica em tempo real e acompanhamento — tudo local. Os números
          aqui servem para acompanhar <em>a sua</em> evolução; não são metas de terceiros nem
          diagnósticos.
        </p>
      </header>

      {needsCalibration && (
        <div className="card">
          <span className="card-accent" />
          <div className="card-header">
            <IconLock style={{ color: 'var(--mint)' }} />
            <div style={{ flex: 1 }}>
              <h3 className="card-title">Antes de começar: calibre o microfone</h3>
              <p className="card-sub">
                2 minutos, uma vez por aparelho — deixa os níveis comparáveis com o mundo real.
              </p>
            </div>
          </div>
          <p className="small muted" style={{ marginBottom: 'var(--sp-3)' }}>
            O app já mede volume em <strong>dBFS</strong>. Com a calibração, ele também estima{' '}
            <strong>dB SPL</strong> (o número de um decibelímetro), o que torna possível comparar
            sua voz com referências reais e acompanhar ganho de volume ao longo das semanas. Você
            precisa de um medidor de SPL — aparelho ou app em outro celular — e de um som
            sustentado, a ~30 cm do microfone.
          </p>
          <div className="row wrap">
            <button className="btn primary sm" onClick={() => setCalibrating(true)}>
              <IconMic className="btn-icon" /> Calibrar agora
            </button>
            <button
              className="btn ghost sm"
              onClick={() =>
                updateSettings({ audio: { calibrationPromptDismissed: true } }, { immediate: true })
              }
            >
              Agora não
            </button>
            <span className="spacer" />
            <span className="hint">Dá para fazer depois em Configurações → Áudio.</span>
          </div>
        </div>
      )}

      {calibrating && (
        <CalibrationDialog open={calibrating} onClose={() => setCalibrating(false)} />
      )}

      <div className="grid cols-4">
        <div className="card tight">
          <div className="stat">
            <span className="stat-value">{data.progress.streakDays}</span>
            <span className="stat-label">dias seguidos</span>
          </div>
        </div>
        <div className="card tight">
          <div className="stat">
            <span className="stat-value">{stats.minutes}</span>
            <span className="stat-label">minutos praticados</span>
          </div>
        </div>
        <div className="card tight">
          <div className="stat">
            <span className="stat-value">{stats.sessions}</span>
            <span className="stat-label">sessões registradas</span>
          </div>
        </div>
        <div className="card tight">
          <div className="stat">
            <span className="stat-value">{stats.avgScore !== null ? stats.avgScore : '—'}</span>
            <span className="stat-label">nota média</span>
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <span className="card-accent" />
          <div className="card-header">
            <IconSparkle style={{ color: 'var(--pink)' }} />
            <div style={{ flex: 1 }}>
              <h3 className="card-title">{t('trainingNextStep')}</h3>
              <p className="card-sub">
                {recommendation?.needsAssessment
                  ? 'Ainda sem avaliação inicial: começamos pelos fundamentos.'
                  : `Baseado no seu histórico e no seu perfil.`}
              </p>
            </div>
          </div>
          {recommendation ? (
            <>
              <h2 className="h3" style={{ marginBottom: 6 }}>
                {recommendation.lesson.title}
              </h2>
              <p className="small muted" style={{ margin: '0 0 var(--sp-3)' }}>
                {recommendation.lesson.objective}
              </p>
              <p className="hint" style={{ marginBottom: 'var(--sp-4)' }}>
                Por que agora: {recommendation.reason}.
              </p>
              <div className="row wrap">
                <button
                  className="btn primary"
                  onClick={() => onNavigate('train', recommendation.lesson.id)}
                >
                  Praticar agora <IconArrowRight className="btn-icon" />
                </button>
                <button className="btn ghost" onClick={() => onNavigate('train')}>
                  Ver trilha completa
                </button>
                <span className="chip">
                  {recommendation.lesson.estimatedMinutes} min · nível {recommendation.lesson.level}
                </span>
              </div>
              {recommendation.alternatives.length > 0 && (
                <p className="hint" style={{ marginTop: 'var(--sp-3)' }}>
                  Alternativas: {recommendation.alternatives.map((a) => a.title).join(' · ')}
                </p>
              )}
            </>
          ) : (
            <p className="small muted">
              Trilha concluída nesta versão. Explore a aba Analisar para continuar medindo.
            </p>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <IconMic style={{ color: 'var(--blue)' }} />
            <div style={{ flex: 1 }}>
              <h3 className="card-title">Sessão rápida</h3>
              <p className="card-sub">Dois minutos para saber como sua voz está hoje.</p>
            </div>
          </div>
          <div className="stack" style={{ gap: 'var(--sp-2)' }}>
            {[
              { label: 'Vogal sustentada (voz limpa, estabilidade)', view: 'analyze' as ViewId },
              { label: 'Leitura de 30 s (melodia, prosódia)', view: 'analyze' as ViewId },
              { label: 'Avaliação inicial completa (4 min)', view: 'assess' as ViewId },
            ].map((item) => (
              <button
                key={item.label}
                className="list-item clickable"
                onClick={() => onNavigate(item.view)}
                style={{ textAlign: 'left', width: '100%' }}
              >
                <IconWave size={15} style={{ color: 'var(--text-faint)' }} />
                <span className="list-title" style={{ flex: 1 }}>
                  {item.label}
                </span>
                <IconArrowRight size={14} style={{ color: 'var(--text-faint)' }} />
              </button>
            ))}
          </div>
          <div className="divider" />
          <div className="row wrap">
            <span className="label">Modo</span>
            <span
              className={`chip ${settings.mode === 'mtf' ? 'pink' : settings.mode === 'ftm' ? 'blue' : 'ok'}`}
            >
              {settings.mode === 'mtf'
                ? t('modeMtf')
                : settings.mode === 'ftm'
                  ? t('modeFtm')
                  : t('modeShared')}
            </span>
            <span className="hint">troque no canto superior direito a qualquer momento</span>
          </div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="card-header">
            <IconTarget style={{ color: 'var(--blue)' }} />
            <div style={{ flex: 1 }}>
              <h3 className="card-title">Perfil vocal</h3>
              <p className="card-sub">
                {profile?.assessedAt
                  ? `Avaliado em ${new Date(profile.assessedAt).toLocaleDateString('pt-BR')}`
                  : 'Ainda não avaliado'}
              </p>
            </div>
          </div>
          {profile ? (
            <div className="stack" style={{ gap: 'var(--sp-3)' }}>
              <div className="grid cols-3" style={{ gap: 'var(--sp-2)' }}>
                {[
                  {
                    label: 'piso',
                    value: profile.floorHz,
                    note: profile.floorHz ? noteName(profile.floorHz) : '',
                  },
                  {
                    label: 'centro',
                    value: profile.comfortableHz,
                    note: profile.comfortableHz ? noteName(profile.comfortableHz) : '',
                  },
                  {
                    label: 'teto',
                    value: profile.ceilingHz,
                    note: profile.ceilingHz ? noteName(profile.ceilingHz) : '',
                  },
                ].map((s) => (
                  <div key={s.label} className="metric-card">
                    <span className="metric-name">{s.label}</span>
                    <span className="metric-value" style={{ fontSize: 'var(--fs-lg)' }}>
                      {s.value ? Math.round(s.value) : '—'}
                      <span className="readout-unit">Hz</span>
                    </span>
                    <span className="hint">{s.note}</span>
                  </div>
                ))}
              </div>
              <p className="hint">
                Extensão medida: {profile.rangeSt.toFixed(1)} semitons ·{' '}
                {RANGE_LABEL_TEXT[profile.rangeLabel]} (rótulo descritivo, não uma meta).
              </p>
              {profile.challenges.length > 0 && (
                <div>
                  <span className="section-title">Pontos a trabalhar</span>
                  <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
                    {profile.challenges.slice(0, 3).map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button className="btn sm" onClick={() => onNavigate('progress')}>
                Ver evolução
              </button>
            </div>
          ) : (
            <div className="stack" style={{ gap: 'var(--sp-3)' }}>
              <p className="small muted" style={{ margin: 0 }}>
                A avaliação leva 4 minutos e mede piso, teto, centro confortável, ressonância e
                controle de altura. Sem ela, as metas do treino ficam só em valores absolutos.
              </p>
              <button className="btn primary" onClick={() => onNavigate('assess')}>
                Fazer avaliação inicial
              </button>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div style={{ flex: 1 }}>
              <h3 className="card-title">Trilha atual</h3>
              <p className="card-sub">
                {t(
                  `mode${settings.mode === 'mtf' ? 'Mtf' : settings.mode === 'ftm' ? 'Ftm' : 'Shared'}` as never,
                )}
              </p>
            </div>
          </div>
          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            {modules.slice(0, 4).map((m) => (
              <div key={m.id}>
                <div className="row" style={{ marginBottom: 4 }}>
                  <span className="small" style={{ flex: 1, color: 'var(--text)' }}>
                    {m.title}
                  </span>
                  <span className="tiny faint mono">
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
              {activeGoals.length > 0
                ? `${activeGoals.length} meta(s) ativa(s)`
                : 'Nenhuma meta ativa'}
            </span>
            <button className="btn sm" onClick={() => onNavigate('progress')}>
              Metas e relatórios
            </button>
          </div>
        </div>
      </div>

      {data.sessions.length > 0 && (
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
            Sessões recentes
          </h3>
          <div className="list">
            {[...data.sessions]
              .slice(-5)
              .reverse()
              .map((s) => (
                <div className="list-item" key={s.id}>
                  <span className={`chip ${s.score !== null && s.score >= 80 ? 'ok' : ''}`}>
                    {s.kind}
                  </span>
                  <span className="list-title" style={{ flex: 1 }}>
                    {s.metrics.f0MedianHz ? `${s.metrics.f0MedianHz.toFixed(0)} Hz` : 'sem f0'} ·{' '}
                    {s.metrics.f0Stability}/100 estabilidade · {s.metrics.resonanceIndex}/100
                    ressonância
                  </span>
                  <span className="list-meta">{new Date(s.createdAt).toLocaleString('pt-BR')}</span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
