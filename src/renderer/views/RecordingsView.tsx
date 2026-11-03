/** Gravações: ouvir, comparar antes/depois, exportar, excluir. */
import { useState } from 'react';
import { useStore } from '../state/store';
import { playPcm, stopPlayback } from '../audio/playback';
import { EmptyState } from '../components/ui';
import {
  IconCompare,
  IconDownload,
  IconPlay,
  IconStop,
  IconTrash,
  IconWave,
} from '../components/Icons';
import { noteName } from '../../core/utils/math';

export function RecordingsView() {
  const { data, loadRecording, exportRecordingWav, deleteRecording, compare, t, settings } =
    useStore();
  const [playing, setPlaying] = useState<string | null>(null);
  const [aId, setAId] = useState<string>('');
  const [bId, setBId] = useState<string>('');
  const [compareBusy, setCompareBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const recordings = [...data.recordings].reverse();
  const comparison = aId && bId && aId !== bId ? compare(aId, bId) : null;

  const play = async (id: string) => {
    if (playing === id) {
      stopPlayback();
      setPlaying(null);
      return;
    }
    const meta = data.recordings.find((r) => r.id === id);
    if (!meta) return;
    const pcm = await loadRecording(id);
    if (!pcm) return;
    await playPcm(pcm, meta.sampleRate, () => setPlaying(null));
    setPlaying(id);
  };

  const playPair = async (first: string, second?: string) => {
    setCompareBusy(true);
    try {
      const m1 = data.recordings.find((r) => r.id === first);
      const pcm1 = await loadRecording(first);
      if (pcm1 && m1) {
        await new Promise<void>((resolve) => {
          void playPcm(pcm1, m1.sampleRate, () => resolve());
        });
      }
      if (second) {
        const m2 = data.recordings.find((r) => r.id === second);
        const pcm2 = await loadRecording(second);
        if (pcm2 && m2) await playPcm(pcm2, m2.sampleRate);
      }
    } finally {
      setCompareBusy(false);
    }
  };

  if (recordings.length === 0) {
    return (
      <div className="card">
        <EmptyState title="Nenhuma gravação" body={t('recordingsEmpty')} />
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-header">
          <IconCompare style={{ color: 'var(--blue)' }} />
          <div style={{ flex: 1 }}>
            <h3 className="card-title">{t('compareTitle')}</h3>
            <p className="card-sub">
              {settings.privacy.storeRecordings
                ? 'Ouça as duas seguidamente e compare as métricas lado a lado.'
                : 'O armazenamento de gravações está desativado nas configurações.'}
            </p>
          </div>
        </div>
        <div className="row wrap">
          <label className="field field-inline">
            <span className="label">{t('compareSelectA')}</span>
            <select value={aId} onChange={(e) => setAId(e.target.value)}>
              <option value="">—</option>
              {recordings.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} ·{' '}
                  {new Date(r.createdAt).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </option>
              ))}
            </select>
          </label>
          <label className="field field-inline">
            <span className="label">{t('compareSelectB')}</span>
            <select value={bId} onChange={(e) => setBId(e.target.value)}>
              <option value="">—</option>
              {recordings.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} ·{' '}
                  {new Date(r.createdAt).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn"
            disabled={!aId || !bId || compareBusy}
            onClick={() => void playPair(aId, bId)}
          >
            <IconPlay className="btn-icon" /> Ouvir A → B
          </button>
        </div>

        {comparison && (
          <div className="stack" style={{ gap: 'var(--sp-3)', marginTop: 'var(--sp-4)' }}>
            <div className="banner info">
              <span>{comparison.summary.join(' ')}</span>
            </div>
            <div className="grid cols-2">
              {comparison.deltas.map((d) => (
                <div className="metric-card" key={d.metric}>
                  <div className="metric-head">
                    <span className="metric-name">{d.label}</span>
                    <span
                      className={`chip tiny ${
                        d.delta === null || Math.abs(d.delta) < 0.05
                          ? ''
                          : d.better === 'either'
                            ? 'blue'
                            : (d.better === 'up' && d.delta > 0) ||
                                (d.better === 'down' && d.delta < 0)
                              ? 'ok'
                              : 'warn'
                      }`}
                    >
                      {d.delta === null ? '—' : `${d.delta > 0 ? '+' : ''}${d.delta.toFixed(1)}`}
                    </span>
                  </div>
                  <div className="metric-value" style={{ fontSize: 'var(--fs-lg)' }}>
                    {d.a === null ? '—' : d.a.toFixed(1)}
                    <span className="readout-unit">
                      → {d.b === null ? '—' : d.b.toFixed(1)} {d.unit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card flush">
        <div className="row" style={{ padding: 'var(--sp-4) var(--sp-5)' }}>
          <h3 className="card-title" style={{ flex: 1 }}>
            Biblioteca ({recordings.length})
          </h3>
          <span className="hint">Criptografadas no disco · apagar é definitivo</span>
        </div>
        <div className="list" style={{ padding: '0 var(--sp-5) var(--sp-5)' }}>
          {recordings.map((r) => (
            <div className="list-item" key={r.id}>
              <IconWave size={15} style={{ color: 'var(--text-faint)' }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="list-title">{r.label}</div>
                <div className="list-meta">
                  {new Date(r.createdAt).toLocaleString('pt-BR')} · {r.durationSec.toFixed(1)} s ·{' '}
                  {r.sampleRate} Hz
                  {r.metrics?.f0MedianHz
                    ? ` · ${r.metrics.f0MedianHz.toFixed(0)} Hz (${noteName(r.metrics.f0MedianHz)})`
                    : ''}
                  {r.metrics?.resonanceIndex
                    ? ` · ressonância ${r.metrics.resonanceIndex}/100`
                    : ''}
                </div>
              </div>
              <button
                className="btn sm"
                onClick={() => void play(r.id)}
                aria-label={playing === r.id ? 'Parar' : 'Ouvir'}
              >
                {playing === r.id ? (
                  <IconStop className="btn-icon" />
                ) : (
                  <IconPlay className="btn-icon" />
                )}
                {playing === r.id ? 'Parar' : 'Ouvir'}
              </button>
              <button
                className="btn sm"
                onClick={() => void exportRecordingWav(r.id)}
                aria-label="Exportar WAV"
              >
                <IconDownload className="btn-icon" />
              </button>
              <button
                className="btn sm danger"
                onClick={() => setConfirmDelete(r.id)}
                aria-label={`Excluir ${r.label}`}
              >
                <IconTrash className="btn-icon" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {confirmDelete && (
        <div
          className="modal-backdrop"
          onClick={(e) => e.target === e.currentTarget && setConfirmDelete(null)}
        >
          <div className="modal" role="dialog" aria-modal="true" aria-label="Confirmar exclusão">
            <h2 className="h3" style={{ marginBottom: 'var(--sp-3)' }}>
              Excluir esta gravação?
            </h2>
            <p className="small muted">
              O arquivo é removido do disco imediatamente. As métricas da sessão continuam no
              histórico, sem áudio.
            </p>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'var(--sp-5)' }}>
              <button className="btn ghost" onClick={() => setConfirmDelete(null)}>
                {t('cancel')}
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  const id = confirmDelete;
                  setConfirmDelete(null);
                  if (playing === id) {
                    stopPlayback();
                    setPlaying(null);
                  }
                  await deleteRecording(id);
                }}
              >
                {t('delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
