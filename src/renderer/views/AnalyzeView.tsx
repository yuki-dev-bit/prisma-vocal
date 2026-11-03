/**
 * Analisar: HUD ao vivo + gravação de tomadas.
 *
 * É a tela de "instrumento": mostra o que está acontecendo com a voz agora,
 * permite gravar uma amostra (com metadados + métricas) e ver o feedback
 * gerado quando a captura é encerrada.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveSession } from '../state/useLiveSession';
import { useStore, useErrorBanner } from '../state/store';
import { PitchRibbon } from '../components/hud/PitchRibbon';
import { Spectrogram } from '../components/hud/Spectrogram';
import { FormantPlot } from '../components/hud/FormantPlot';
import { LevelMeter } from '../components/hud/LevelMeter';
import { GaugeArc } from '../components/hud/GaugeArc';
import { FeedbackList, MetricsGrid, EmptyState, Segmented } from '../components/ui';
import { IconMic, IconStop, IconRecord, IconDownload, IconSave } from '../components/Icons';
import { generateFeedback } from '../../core/feedback/engine';
import { shortId, noteName } from '../../core/utils/math';
import type {
  FeedbackItem,
  RecordingMeta,
  SessionMetrics,
  SessionRecord,
} from '../../shared/types';

export function AnalyzeView() {
  const { settings, data, t, saveSession, saveRecording, exportRecordingWav, pushBanner } =
    useStore();
  const reportError = useErrorBanner();
  const session = useLiveSession();
  const [result, setResult] = useState<{
    metrics: SessionMetrics;
    feedback: FeedbackItem[];
    durationSec: number;
  } | null>(null);
  const [kind, setKind] = useState<'sustentado' | 'fala' | 'livre'>('fala');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastRecordingId, setLastRecordingId] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement | null>(null);

  // Ao terminar uma tomada, leva o resultado para a área visível: sem isso o
  // feedback nasce abaixo do HUD e a pessoa não percebe que foi gerado.
  useEffect(() => {
    if (!result || !resultRef.current) return;
    resultRef.current.scrollIntoView({
      behavior: settings.ui.reducedMotion ? 'auto' : 'smooth',
      block: 'nearest',
    });
  }, [result, settings.ui.reducedMotion]);

  const live = session.readout;
  const elapsedLabel = useMemo(() => {
    const s = Math.floor(session.elapsedSec);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, [session.elapsedSec]);

  const handleStart = async () => {
    setResult(null);
    setLastRecordingId(null);
    const ok = await session.start({ record: true });
    if (!ok) {
      reportError(
        new Error(session.error ?? 'Não foi possível iniciar a captura.'),
        'analyze.start',
      );
    }
  };

  const handleStop = async () => {
    const res = session.stop({ speech: kind === 'fala' });
    if (!res) {
      pushBanner({
        kind: 'warn',
        message: 'Nenhum áudio foi capturado. Verifique o microfone e tente novamente.',
      });
      return;
    }
    const feedback = generateFeedback({
      metrics: res.metrics,
      kind,
      baseline: {
        f0: data.profile?.comfortableHz ?? null,
        brightness: null,
      },
      calibration: settings.audio.calibrationOffsetDb > 0,
    });
    setResult({ metrics: res.metrics, feedback, durationSec: res.durationSec });

    const sid = shortId('s_');
    const record: SessionRecord = {
      id: sid,
      createdAt: new Date().toISOString(),
      mode: settings.mode,
      kind,
      durationSec: res.durationSec,
      metrics: res.metrics,
      score: null,
      recordingId: null,
      feedback,
    };
    saveSession(record);

    if (res.pcm && res.pcm.length > 0 && settings.privacy.storeRecordings) {
      setBusy(true);
      try {
        const meta: RecordingMeta = {
          id: shortId('r_'),
          createdAt: record.createdAt,
          label: label.trim() || `Tomada ${kind} · ${new Date().toLocaleDateString('pt-BR')}`,
          kind,
          durationSec: res.durationSec,
          sampleRate: res.sampleRate,
          encrypted: true,
          metrics: res.metrics,
          tags: [kind],
        };
        const id = await saveRecording(meta, res.pcm, res.sampleRate);
        if (id) setLastRecordingId(id);
      } finally {
        setBusy(false);
      }
    }
  };

  return (
    <div className="grid analyze">
      <div className="hud">
        <div className="hud-display">
          <div className="hud-topline">
            <span className={`chip ${session.status === 'running' ? 'ok pulse' : ''}`}>
              <span className="dot" />
              {session.status === 'running'
                ? t('micLive')
                : session.status === 'error'
                  ? // o rótulo segue a causa real: "permissão negada" estava
                    // aparecendo também quando o microfone estava ocupado por outro app
                    session.errorKind === 'busy'
                    ? 'Microfone em uso'
                    : session.errorKind === 'device'
                      ? 'Microfone indisponível'
                      : t('micDenied')
                  : t('micIdle')}
            </span>
            <span className="mono">{elapsedLabel}</span>
            {session.status === 'running' && (
              <span className="faint">
                {session.sampleRate} Hz · latência ≈ {session.latencyMs} ms
              </span>
            )}
            <span className="spacer" />
            {session.recording && (
              <span className="chip danger pulse">
                <span className="dot" />
                REC
              </span>
            )}
          </div>

          <div className="hud-readouts">
            <div className="readout">
              <span className="readout-label">{t('hudPitch')}</span>
              <span className="readout-value">
                {live.f0 ? live.f0.toFixed(1) : '—'}
                <span className="readout-unit">Hz</span>
              </span>
              <span className="readout-note">{live.f0 ? noteName(live.f0) : 'silêncio'}</span>
            </div>
            <div className="readout">
              <span className="readout-label">{t('hudLevel')}</span>
              <span className="readout-value">
                {live.levelDb > -100 ? live.levelDb.toFixed(0) : '—'}
                <span className="readout-unit">dBFS</span>
              </span>
              <span className="readout-note">
                {live.splDb !== null
                  ? `≈ ${live.splDb.toFixed(0)} dB SPL (estimado)`
                  : 'sem calibração'}
              </span>
            </div>
            <div className="readout">
              <span className="readout-label">{t('hudResonance')}</span>
              <span className="readout-value">
                {live.voiced ? live.resonance : '—'}
                <span className="readout-unit">/100</span>
              </span>
              <span className="readout-note">
                {live.formants
                  ? `F1 ${live.formants[0] ?? '—'} · F2 ${live.formants[1] ?? '—'}`
                  : 'estimativa de timbre'}
              </span>
            </div>
          </div>

          <LevelMeter peak={live.peak} levelDb={live.levelDb} clipping={live.clipping} />

          <div className="canvas-wrap">
            <PitchRibbon
              buffer={session.buffer}
              minHz={session.bounds.hudMin}
              maxHz={session.bounds.hudMax}
              reducedMotion={settings.ui.reducedMotion}
              colorSafe={settings.ui.colorBlindSafe}
            />
          </div>

          {settings.ui.showSpectrogram && (
            <div className="canvas-wrap" style={{ paddingTop: 0 }}>
              <Spectrogram
                buffer={session.buffer}
                reducedMotion={settings.ui.reducedMotion}
                colorSafe={settings.ui.colorBlindSafe}
              />
            </div>
          )}

          <div className="gauges" style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
            <GaugeArc value={live.resonance} label="Ressonância" tag="brilho" />
            <GaugeArc value={live.breathiness * 100} label="Soprosidade" tag="ar na voz" invert />
            <GaugeArc
              value={live.hnrDb !== null ? Math.max(0, Math.min(100, (live.hnrDb / 30) * 100)) : 0}
              label="Clareza"
              tag="HNR"
            />
            <GaugeArc
              value={
                live.levelDb > -100
                  ? Math.max(0, Math.min(100, ((live.levelDb + 60) / 60) * 100))
                  : 0
              }
              label="Nível"
              tag="entrada"
            />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div style={{ flex: 1 }}>
              <h3 className="card-title">Captura</h3>
              <p className="card-sub">
                Gravação local, criptografada no app desktop. Nada é enviado para servidores.
              </p>
            </div>
            {lastRecordingId && (
              <button className="btn sm" onClick={() => void exportRecordingWav(lastRecordingId)}>
                <IconDownload className="btn-icon" /> Exportar WAV
              </button>
            )}
          </div>

          <div className="stack" style={{ gap: 'var(--sp-3)' }}>
            <div className="row wrap">
              <Segmented
                ariaLabel="Tipo de tomada"
                value={kind}
                onChange={(v) => setKind(v)}
                options={[
                  { id: 'fala', label: 'Fala' },
                  { id: 'sustentado', label: 'Vogal sustentada' },
                  { id: 'livre', label: 'Livre' },
                ]}
              />
              <span className="spacer" />
              {session.status !== 'running' ? (
                <button
                  className="btn primary"
                  onClick={() => void handleStart()}
                  disabled={session.status === 'starting' || busy}
                >
                  <IconMic className="btn-icon" />
                  {session.status === 'starting' ? t('loading') : 'Iniciar captura'}
                </button>
              ) : (
                <button className="btn danger" onClick={() => void handleStop()}>
                  <IconStop className="btn-icon" /> Parar e analisar
                </button>
              )}
            </div>

            <label className="field">
              <span className="label">Rótulo da gravação (opcional)</span>
              <input
                type="text"
                value={label}
                maxLength={120}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Ex.: leitura do texto, voz do dia, comparação"
              />
            </label>

            {session.error && (
              <div className="banner danger">
                <span style={{ flex: 1 }}>{session.error}</span>
                <button
                  className="btn sm"
                  style={{ marginLeft: 'var(--sp-2)' }}
                  onClick={() => void handleStart()}
                >
                  Tentar de novo
                </button>
              </div>
            )}
            {session.status === 'running' && (
              <div className="hint">
                Dica: fale a um palmo do microfone e mantenha o nível entre −24 e −12 dBFS. Clipping
                invalida as medidas.
              </div>
            )}
          </div>
        </div>

        {result && (
          <div className="card" ref={resultRef}>
            <div className="card-header">
              <div style={{ flex: 1 }}>
                <h3 className="card-title">Resultado da tomada</h3>
                <p className="card-sub">
                  {result.durationSec.toFixed(1)} s · {t('disclaimer')}
                </p>
              </div>
            </div>
            <MetricsGrid metrics={result.metrics} />
            <div className="divider" />
            <FeedbackList items={result.feedback} />
          </div>
        )}
      </div>

      <div className="stack">
        <div className="card">
          <div className="card-header">
            <div style={{ flex: 1 }}>
              <h3 className="card-title">Plano de formantes</h3>
              <p className="card-sub">
                Estimativa por LPC — leia como tendência, não como valor exato.
              </p>
            </div>
          </div>
          {settings.ui.showFormants ? (
            <FormantPlot
              buffer={session.buffer}
              reducedMotion={settings.ui.reducedMotion}
              colorSafe={settings.ui.colorBlindSafe}
            />
          ) : (
            <EmptyState
              title="Visualização desativada"
              body="Ative em Configurações → Interface."
            />
          )}
        </div>

        <div className="card">
          <h3 className="card-title">Como ler o HUD</h3>
          <div className="stack" style={{ gap: 'var(--sp-3)', marginTop: 'var(--sp-3)' }}>
            <p className="small muted" style={{ margin: 0 }}>
              <strong style={{ color: 'var(--text)' }}>Fita de altura:</strong> cada ponto é a
              altura da voz em 16 ms. Linhas horizontais são notas (Dó). Movimento contínuo é
              melodia; saltos são mudanças de registro.
            </p>
            <p className="small muted" style={{ margin: 0 }}>
              <strong style={{ color: 'var(--text)' }}>Ressonância:</strong> índice de brilho
              comparável só com você mesmo (altura relativa ao seu f0 + energia de presença).
            </p>
            <p className="small muted" style={{ margin: 0 }}>
              <strong style={{ color: 'var(--text)' }}>Soprosidade:</strong> quanto de ar escapa sem
              vibração. Valores altos pedem contato mais firme, não mais força.
            </p>
            <p className="small muted" style={{ margin: 0 }}>
              <strong style={{ color: 'var(--text)' }}>Espectrograma:</strong> alternativa visual ao
              som. Bom para treinar sem fones e para quem tem baixa audição.
            </p>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Últimas tomadas</h3>
          <div className="list" style={{ marginTop: 'var(--sp-3)' }}>
            {data.recordings.length === 0 && <p className="hint">Nenhuma gravação ainda.</p>}
            {[...data.recordings]
              .slice(-4)
              .reverse()
              .map((r) => (
                <div className="list-item" key={r.id}>
                  <IconRecord size={14} style={{ color: 'var(--pink)' }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      className="list-title"
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {r.label}
                    </div>
                    <div className="list-meta">
                      {new Date(r.createdAt).toLocaleString('pt-BR')} · {r.durationSec.toFixed(1)} s
                      ·{' '}
                      {r.metrics?.f0MedianHz
                        ? `${r.metrics.f0MedianHz.toFixed(0)} Hz`
                        : 'sem métricas'}
                    </div>
                  </div>
                  <button
                    className="btn sm"
                    onClick={() => void exportRecordingWav(r.id)}
                    aria-label={` exportar ${r.label}`}
                  >
                    <IconSave className="btn-icon" />
                  </button>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
