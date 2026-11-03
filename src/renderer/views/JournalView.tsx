/** Diário vocal: contexto subjetivo + métricas do dia. */
import { useState } from 'react';
import { useStore, useErrorBanner } from '../state/store';
import { EmptyState } from '../components/ui';
import { IconJournal, IconTrash } from '../components/Icons';
import { shortId } from '../../core/utils/math';
import type { JournalEntry } from '../../shared/types';

const MOOD_LABELS = ['muito difícil', 'difícil', 'neutro', 'bom', 'muito bom'];

export function JournalView() {
  const { data, addJournal, deleteJournal, t, pushBanner } = useStore();
  const reportError = useErrorBanner();
  const [mood, setMood] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [energy, setEnergy] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (notes.length > 2000) {
      setError('A anotação deve ter até 2000 caracteres.');
      return;
    }
    try {
      const last = data.sessions.at(-1);
      const entry: JournalEntry = {
        id: shortId('j_'),
        date: new Date().toISOString(),
        mood,
        energy,
        notes: notes.trim(),
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 8),
        metrics: last
          ? { f0MedianHz: last.metrics.f0MedianHz, resonanceIndex: last.metrics.resonanceIndex }
          : undefined,
      };
      addJournal(entry);
      setNotes('');
      setTags('');
      setError(null);
      pushBanner({ kind: 'info', message: 'Anotação salva.' });
    } catch (err) {
      reportError(err, 'journal.submit');
    }
  };

  const entries = [...data.journal].reverse();

  return (
    <div className="grid analyze">
      <div className="stack">
        <div className="card">
          <div className="card-header">
            <IconJournal style={{ color: 'var(--blue)' }} />
            <div style={{ flex: 1 }}>
              <h3 className="card-title">{t('journalNew')}</h3>
              <p className="card-sub">
                Registrar contexto ajuda a interpretar a evolução (sono, cansaço, ambiente).
              </p>
            </div>
          </div>
          <div className="stack" style={{ gap: 'var(--sp-4)' }}>
            <div className="field">
              <span className="label">
                {t('journalMood')}: {MOOD_LABELS[mood - 1]}
              </span>
              <div className="row">
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    className={`btn sm ${mood === v ? 'primary' : ''}`}
                    onClick={() => setMood(v as 1 | 2 | 3 | 4 | 5)}
                    aria-pressed={mood === v}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="label">{t('journalEnergy')}</span>
              <div className="row">
                {[1, 2, 3, 4, 5].map((v) => (
                  <button
                    key={v}
                    className={`btn sm ${energy === v ? 'primary' : ''}`}
                    onClick={() => setEnergy(v as 1 | 2 | 3 | 4 | 5)}
                    aria-pressed={energy === v}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span className="label">{t('journalNotes')}</span>
              <textarea
                value={notes}
                maxLength={2000}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Como a voz estava hoje? Algo doeu? O ambiente era ruidoso?"
              />
              <span className="hint">{notes.length}/2000 · fica só neste dispositivo</span>
            </label>
            <label className="field">
              <span className="label">Etiquetas (separadas por vírgula)</span>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="aquecimento, telefone, rouquidão"
              />
            </label>
            {error && <div className="banner danger">{error}</div>}
            <div>
              <button className="btn primary" onClick={submit}>
                {t('save')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="stack">
        <div className="card">
          <h3 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
            Histórico ({entries.length})
          </h3>
          {entries.length === 0 ? (
            <EmptyState title="Sem anotações" body={t('journalEmpty')} />
          ) : (
            <div className="list">
              {entries.map((e) => (
                <div className="list-item" key={e.id} style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                      <span className="list-title">
                        {new Date(e.date).toLocaleDateString('pt-BR')}
                      </span>
                      <span className="chip tiny">humor {e.mood}/5</span>
                      <span className="chip tiny">energia {e.energy}/5</span>
                      {e.metrics?.f0MedianHz && (
                        <span className="chip tiny mono">{e.metrics.f0MedianHz.toFixed(0)} Hz</span>
                      )}
                    </div>
                    <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>
                      {e.notes || '(sem texto)'}
                    </div>
                    {e.tags.length > 0 && (
                      <div className="kv">
                        {e.tags.map((tag) => (
                          <span className="chip tiny" key={tag}>
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    className="icon-btn"
                    onClick={() => deleteJournal(e.id)}
                    aria-label="Excluir anotação"
                  >
                    <IconTrash size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
