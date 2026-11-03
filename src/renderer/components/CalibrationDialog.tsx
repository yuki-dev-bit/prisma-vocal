/**
 * Calibração guiada do microfone (dBFS → dB SPL).
 *
 * Por que existe: sem calibração o app só mostra dBFS — um número relativo, que
 * não conversa com o mundo real ("minha voz tem 62 dB SPL ou 75?"). A conversão
 * depende do ganho analógico de cada aparelho, então só pode vir de uma medição:
 * compara-se o que o app lê (dBFS) com o que um medidor de SPL mostra.
 *
 * O componente guia em três passos (explicar → medir → confirmar), mostra a
 * data em que a calibração foi salva e grava no disco na hora (`immediate`),
 * para que o valor sobreviva a fechar o app ou reiniciar o aparelho.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { useLiveSession } from '../state/useLiveSession';
import { LevelMeter } from './hud/LevelMeter';
import { Modal } from './ui';
import { IconAlert, IconCheck, IconMic, IconStop } from './Icons';
import {
  computeCalibrationOffset,
  formatCalibratedAt,
  isCalibrationLevelUsable,
  MAX_SPL_DB,
  MIN_SPL_DB,
} from '../../core/audio/calibration';

export type CalibrationStep = 'intro' | 'measure' | 'done';

export function CalibrationDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, updateSettings, locale } = useStore();
  const session = useLiveSession();
  const [step, setStep] = useState<CalibrationStep>('intro');
  const [splInput, setSplInput] = useState(75);
  const [levelDb, setLevelDb] = useState<number | null>(null);
  const [savedOffset, setSavedOffset] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const currentOffset = settings.audio.calibrationOffsetDb;
  const currentDate = formatCalibratedAt(settings.audio.calibratedAt, locale);

  // Ao abrir, sempre recomeça pela explicação — quem já é calibrado vê o
  // valor atual e pode optar por refazer.
  useEffect(() => {
    if (open) {
      setStep('intro');
      setSavedOffset(null);
      setLevelDb(null);
    }
  }, [open]);

  // Libera o microfone ao fechar o diálogo (no Android dois streams
  // simultâneos falham com NotReadableError).
  useEffect(() => {
    if (!open) session.discard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Mediana do nível recente: mais estável que o quadro instantâneo.
  //
  // A função vai por ref de propósito: `session` é um objeto novo a cada render
  // (o hook atualiza a leitura a 10 Hz). Com `session` nas dependências, o
  // intervalo era recriado a cada 100 ms e nunca chegava a disparar — o nível
  // ficava preso em "aguardando áudio…" e o botão Salvar nunca habilitava.
  const recentLevelRef = useRef(session.recentLevelDb);
  recentLevelRef.current = session.recentLevelDb;
  useEffect(() => {
    if (!open || step !== 'measure') return;
    const tick = () => setLevelDb(recentLevelRef.current(40));
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [open, step]);

  const startMeasure = useCallback(async () => {
    setBusy(true);
    const ok = await session.start();
    setBusy(false);
    setLevelDb(null);
    if (ok) setStep('measure');
  }, [session]);

  const save = useCallback(() => {
    if (!isCalibrationLevelUsable(levelDb)) return;
    const offset = computeCalibrationOffset(levelDb, splInput);
    updateSettings(
      {
        audio: {
          calibrationOffsetDb: offset,
          calibratedAt: new Date().toISOString(),
          calibrationPromptDismissed: true,
        },
      },
      { immediate: true },
    );
    setSavedOffset(offset);
    session.discard();
    setStep('done');
  }, [levelDb, session, splInput, updateSettings]);

  const remove = useCallback(() => {
    updateSettings({ audio: { calibrationOffsetDb: 0, calibratedAt: null } }, { immediate: true });
    setSavedOffset(null);
    setStep('intro');
  }, [updateSettings]);

  if (!open) return null;

  const tooQuiet = levelDb !== null && !isCalibrationLevelUsable(levelDb);
  const previewOffset = isCalibrationLevelUsable(levelDb)
    ? computeCalibrationOffset(levelDb, splInput)
    : null;

  return (
    <Modal
      title="Calibração do microfone"
      onClose={() => {
        session.discard();
        onClose();
      }}
      footer={
        step === 'measure' ? (
          <div className="row wrap" style={{ width: '100%', justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => session.stop()}>
              <IconStop className="btn-icon" /> Cancelar medição
            </button>
            <button className="btn primary" disabled={previewOffset === null} onClick={save}>
              <IconCheck className="btn-icon" /> Salvar calibração
            </button>
          </div>
        ) : step === 'done' ? (
          <div className="row wrap" style={{ width: '100%', justifyContent: 'flex-end' }}>
            <button className="btn ghost" onClick={() => setStep('intro')}>
              Refazer
            </button>
            <button className="btn primary" onClick={onClose}>
              Concluir
            </button>
          </div>
        ) : (
          <div className="row wrap" style={{ width: '100%', justifyContent: 'flex-end' }}>
            {currentOffset > 0 && (
              <button className="btn ghost" onClick={remove}>
                Remover calibração
              </button>
            )}
            <button
              className="btn primary"
              disabled={busy || session.status === 'starting'}
              onClick={() => void startMeasure()}
            >
              <IconMic className="btn-icon" />{' '}
              {currentOffset > 0 ? 'Refazer medição' : 'Iniciar medição'}
            </button>
          </div>
        )
      }
    >
      {step === 'intro' && (
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <p className="lead" style={{ margin: 0 }}>
            O app mede o volume em <strong>dBFS</strong> (relativo ao máximo digital). Para
            converter em <strong>dB SPL</strong> — o número que um medidor de mão mostra —
            precisamos comparar as duas leituras uma vez, por aparelho.
          </p>
          <ol className="stack" style={{ gap: 'var(--sp-2)', paddingLeft: '1.2em', margin: 0 }}>
            <li>
              Tenha um medidor de SPL à mão (aparelho físico ou app de decibelímetro no outro
              celular).
            </li>
            <li>Fique em ambiente silencioso, a ~30 cm do microfone.</li>
            <li>Sustente um som constante (um “aaa” confortável) por uns 3 segundos.</li>
            <li>Informe aqui o valor que o medidor mostrou e confirme.</li>
          </ol>
          <div className={currentOffset > 0 ? 'banner ok' : 'banner info'}>
            {currentOffset > 0 ? (
              <>
                <IconCheck className="btn-icon" /> Calibrado com offset de{' '}
                <strong>{currentOffset} dB</strong>
                {currentDate ? ` em ${currentDate}.` : '.'} Você pode refazer quando trocar de
                microfone ou de aparelho.
              </>
            ) : (
              <>
                <IconAlert className="btn-icon" /> Sem calibração, os níveis aparecem em dBFS e as
                estimativas em dB SPL ficam ocultas. Os exercícios funcionam do mesmo jeito.
              </>
            )}
          </div>
          {session.error && <div className="banner danger">{session.error}</div>}
        </div>
      )}

      {step === 'measure' && (
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <div className="row wrap" style={{ justifyContent: 'space-between' }}>
            <span className="label" style={{ margin: 0 }}>
              Sustente o som agora
            </span>
            <span className="chip mono">
              {levelDb === null ? 'aguardando áudio…' : `${levelDb.toFixed(1)} dBFS`}
            </span>
          </div>
          <LevelMeter
            peak={session.readout.peak}
            levelDb={session.readout.levelDb}
            clipping={session.readout.clipping}
          />
          {tooQuiet && (
            <div className="banner warn">
              <IconAlert className="btn-icon" /> Sinal muito baixo. Aproxime-se do microfone,
              aumente o ganho em Configurações → Áudio ou fale mais forte.
            </div>
          )}
          {session.status === 'error' && session.error && (
            <div className="banner danger">{session.error}</div>
          )}
          <label className="field">
            <span className="label">Valor mostrado no medidor de SPL (dB)</span>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_SPL_DB}
              max={MAX_SPL_DB}
              value={splInput}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSplInput(
                  Number.isFinite(v) ? Math.min(MAX_SPL_DB, Math.max(MIN_SPL_DB, v)) : MIN_SPL_DB,
                );
              }}
            />
            <span className="hint">
              {previewOffset === null
                ? 'Aguarde o nível estabilizar para ver o offset.'
                : `Offset calculado: ${previewOffset} dB → o que hoje é ${levelDb?.toFixed(0)} dBFS passa a ser lido como ${splInput} dB SPL.`}
            </span>
          </label>
          <p className="hint" style={{ margin: 0 }}>
            A calibração é por aparelho e por microfone: refaça se trocar de celular, de fone com
            microfone ou se mudar o ganho de entrada em mais de ~6 dB.
          </p>
        </div>
      )}

      {step === 'done' && (
        <div className="stack" style={{ gap: 'var(--sp-4)' }}>
          <div className="banner ok">
            <IconCheck className="btn-icon" /> Calibração concluída e salva.
          </div>
          <div className="grid cols-2">
            <div className="metric-card">
              <span className="stat-value">{savedOffset ?? currentOffset} dB</span>
              <span className="stat-label">offset dBFS → dB SPL</span>
            </div>
            <div className="metric-card">
              <span className="stat-value" style={{ fontSize: 'var(--fs-md)' }}>
                {formatCalibratedAt(settings.audio.calibratedAt, locale) ?? 'agora'}
              </span>
              <span className="stat-label">salvo neste aparelho</span>
            </div>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            O valor fica guardado com os seus dados e continua valendo depois de fechar o app ou
            reiniciar o celular. Você pode rever ou refazer em Configurações → Áudio.
          </p>
        </div>
      )}
    </Modal>
  );
}
