/** Configurações: áudio, interface, acessibilidade, privacidade, dados e sobre. */
import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { useLiveSession } from '../state/useLiveSession';
import { Slider, Toggle, Segmented, Modal } from '../components/ui';
import { LevelMeter } from '../components/hud/LevelMeter';
import { AudioEngine } from '../../audio/AudioEngine';
import { VOICE_PRESETS, presetForProfile } from '../../core/settings/defaults';
import { AVAILABLE_LOCALES } from '../../core/i18n';
import { LogoMark } from '../components/Logo';
import {
  IconDownload,
  IconGithub,
  IconMic,
  IconStop,
  IconUpload,
  IconLock,
  IconAlert,
} from '../components/Icons';
import { CalibrationDialog } from '../components/CalibrationDialog';
import { formatCalibratedAt } from '../../core/audio/calibration';

type Tab = 'audio' | 'interface' | 'acessibilidade' | 'privacidade' | 'dados' | 'sobre';

export function SettingsView() {
  const {
    settings,
    updateSettings,
    system,
    data,
    t,
    locale,
    exportBackup,
    importBackup,
    clearAll,
    openExternal,
  } = useStore();
  const [tab, setTab] = useState<Tab>('audio');
  const [devices, setDevices] = useState<{ deviceId: string; label: string; kind: string }[]>([]);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const session = useLiveSession();
  const preset = useMemo(() => presetForProfile(data.profile), [data.profile]);

  // Rótulos de dispositivo só existem depois da permissão de microfone; por isso
  // a lista é recarregada quando a captura começa a rodar.
  useEffect(() => {
    void AudioEngine.listDevices()
      .then(setDevices)
      .catch(() => setDevices([]));
  }, [session.status]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'audio', label: 'Áudio' },
    { id: 'interface', label: 'Interface' },
    { id: 'acessibilidade', label: t('a11yTitle') },
    { id: 'privacidade', label: 'Privacidade' },
    { id: 'dados', label: 'Dados' },
    { id: 'sobre', label: 'Sobre' },
  ];

  const calibratedLabel = formatCalibratedAt(settings.audio.calibratedAt, locale);

  return (
    <div className="stack">
      <div className="tabs" role="tablist" aria-label="Seções de configuração">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            className="tab"
            role="tab"
            aria-selected={tab === tb.id}
            onClick={() => setTab(tb.id)}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {tab === 'audio' && (
        <div className="grid cols-2">
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--sp-4)' }}>
              Entrada e monitoramento
            </h3>
            <div className="stack" style={{ gap: 'var(--sp-4)' }}>
              <label className="field">
                <span className="label">{t('deviceSelect')}</span>
                <select
                  value={settings.audio.inputDeviceId ?? ''}
                  onChange={(e) =>
                    updateSettings({ audio: { inputDeviceId: e.target.value || null } })
                  }
                >
                  <option value="">Padrão do sistema</option>
                  {devices
                    .filter((d) => d.kind === 'audioinput')
                    .map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label}
                      </option>
                    ))}
                </select>
                <span className="hint">
                  {devices.length === 0
                    ? 'Nenhum dispositivo listado ainda — conceda permissão de microfone em "Testar entrada".'
                    : `${devices.filter((d) => d.kind === 'audioinput').length} entrada(s) disponível(is).`}
                </span>
              </label>

              <Slider
                label={t('gain')}
                value={settings.audio.gainDb}
                min={-24}
                max={24}
                step={1}
                unit="dB"
                onChange={(v) => updateSettings({ audio: { gainDb: v } })}
                hint="Aumente até o pico da fala ficar entre −12 e −6 dBFS. Ganho alto demais causa clipping."
              />
              <Slider
                label={t('sensitivity')}
                value={settings.audio.inputSensitivity}
                min={0.2}
                max={3}
                step={0.05}
                onChange={(v) => updateSettings({ audio: { inputSensitivity: v } })}
                format={(v) => `${v.toFixed(2)}×`}
                hint="Ajuste fino de sensibilidade do medidor (não altera o sinal gravado)."
              />

              <Toggle
                label={t('noiseReduction')}
                hint="Portão de ruído do app. Desligado por padrão: filtros agressivos distorcem as medidas de soprosidade."
                checked={settings.audio.noiseSuppression}
                onChange={(v) => updateSettings({ audio: { noiseSuppression: v } })}
              />
              <Slider
                label={`${t('noiseGate')} (limiar)`}
                value={settings.audio.noiseGateThresholdDb}
                min={-80}
                max={-30}
                step={1}
                unit="dBFS"
                onChange={(v) => updateSettings({ audio: { noiseGateThresholdDb: v } })}
                hint="Sons abaixo deste nível são atenuados. Para vozes muito graves, use −60 dBFS para não cortar o fundamental."
              />

              <Toggle
                label={t('monitoring')}
                hint={t('monitoringHint')}
                checked={settings.audio.monitoring}
                onChange={(v) => updateSettings({ audio: { monitoring: v } })}
              />
              <Slider
                label="Volume do monitoramento"
                value={Math.round(settings.audio.monitoringVolume * 100)}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={(v) => updateSettings({ audio: { monitoringVolume: v / 100 } })}
              />

              <div className="field">
                <span className="label">{t('latency')}</span>
                <Segmented
                  value={settings.audio.latencyHint}
                  onChange={(v) => updateSettings({ audio: { latencyHint: v } })}
                  options={[
                    { id: 'interactive', label: 'Baixa' },
                    { id: 'balanced', label: 'Equilibrada' },
                    { id: 'playback', label: 'Estável' },
                  ]}
                />
                <span className="hint">
                  Latência em uso: ≈ {session.latencyMs || '—'} ms. Valores menores reagem mais
                  rápido; maiores são mais tolerantes a falhas de driver.
                </span>
              </div>

              <label className="field">
                <span className="label">Taxa de amostragem solicitada</span>
                <select
                  value={settings.audio.requestedSampleRate}
                  onChange={(e) =>
                    updateSettings({ audio: { requestedSampleRate: Number(e.target.value) } })
                  }
                >
                  <option value={44100}>44 100 Hz</option>
                  <option value={48000}>48 000 Hz (recomendado)</option>
                  <option value={96000}>96 000 Hz</option>
                </select>
                <span className="hint">
                  O driver pode impor outra taxa; o app usa a taxa real do dispositivo e mostra no
                  HUD.
                </span>
              </label>
            </div>
          </div>

          <div className="stack">
            <div className="card">
              <div className="card-header">
                <IconMic style={{ color: 'var(--blue)' }} />
                <div style={{ flex: 1 }}>
                  <h3 className="card-title">Testar entrada</h3>
                  <p className="card-sub">
                    Verifica microfone, nível, clipping e ruído antes de treinar.
                  </p>
                </div>
              </div>
              {session.status === 'running' ? (
                <>
                  <LevelMeter
                    peak={session.readout.peak}
                    levelDb={session.readout.levelDb}
                    clipping={session.readout.clipping}
                  />
                  <div className="row wrap" style={{ marginTop: 'var(--sp-3)' }}>
                    <span className="chip mono">{session.readout.levelDb.toFixed(0)} dBFS</span>
                    {session.readout.splDb !== null && (
                      <span className="chip mono">≈ {session.readout.splDb.toFixed(0)} dB SPL</span>
                    )}
                    <span className="chip mono">
                      {session.readout.f0 ? `${session.readout.f0.toFixed(0)} Hz` : 'sem f0'}
                    </span>
                    <span className="chip mono">{session.sampleRate} Hz</span>
                    {session.readout.clipping && <span className="chip danger">clipping</span>}
                    <span className="spacer" />
                    <button className="btn danger sm" onClick={() => session.stop()}>
                      <IconStop className="btn-icon" /> Parar
                    </button>
                  </div>
                </>
              ) : (
                <div className="row wrap">
                  <button className="btn primary sm" onClick={() => void session.start()}>
                    <IconMic className="btn-icon" /> Iniciar teste
                  </button>
                  <span className="hint">Permissão de microfone será solicitada pelo sistema.</span>
                </div>
              )}
              {session.error && (
                <div className="banner danger" style={{ marginTop: 'var(--sp-3)' }}>
                  <IconAlert className="btn-icon" />
                  <span style={{ flex: 1 }}>{session.error}</span>
                  <button
                    className="btn sm"
                    style={{ marginLeft: 'var(--sp-2)' }}
                    onClick={() => void session.start()}
                  >
                    Tentar de novo
                  </button>
                </div>
              )}
            </div>

            <div className="card">
              <h3 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
                Preset de voz
              </h3>
              <p className="hint" style={{ marginBottom: 'var(--sp-3)' }}>
                Ajusta a faixa de análise e o ganho inicial. O preset sugerido para o seu perfil é{' '}
                <strong>{preset.label}</strong> ({preset.analysis.minF0}–{preset.analysis.maxF0}{' '}
                Hz).
              </p>
              <div className="list">
                {VOICE_PRESETS.map((p) => (
                  <div className="list-item" key={p.id}>
                    <div style={{ flex: 1 }}>
                      <div className="list-title">{p.label}</div>
                      <div className="list-meta">{p.description}</div>
                    </div>
                    {p.id === preset.id && <span className="chip ok tiny">sugerido</span>}
                    <button
                      className="btn sm"
                      onClick={() =>
                        updateSettings({
                          audio: {
                            gainDb: p.audio.gainDb ?? settings.audio.gainDb,
                            noiseGateThresholdDb:
                              p.audio.noiseGateThresholdDb ?? settings.audio.noiseGateThresholdDb,
                            inputSensitivity:
                              p.audio.inputSensitivity ?? settings.audio.inputSensitivity,
                          },
                        })
                      }
                    >
                      aplicar áudio
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <IconLock style={{ color: 'var(--mint)' }} />
                <div style={{ flex: 1 }}>
                  <h3 className="card-title">{t('calibration')}</h3>
                  <p className="card-sub">
                    {settings.audio.calibrationOffsetDb > 0
                      ? `Calibrado com offset de ${settings.audio.calibrationOffsetDb} dB${calibratedLabel ? ` em ${calibratedLabel}` : ''}.`
                      : 'Sem calibração — os níveis aparecem em dBFS.'}
                  </p>
                </div>
                {settings.audio.calibrationOffsetDb > 0 && (
                  <span className="chip ok tiny">salvo</span>
                )}
              </div>
              <p className="hint" style={{ marginBottom: 'var(--sp-3)' }}>
                {t('calibrationHint')} A calibração é por aparelho e microfone, e fica salva mesmo
                depois de fechar o app ou reiniciar o celular.
              </p>
              <div className="row wrap">
                <button
                  className="btn sm primary"
                  onClick={() => {
                    // Um único stream de microfone por vez: no Android dois
                    // getUserMedia simultâneos falham com NotReadableError.
                    session.discard();
                    setCalibrating(true);
                  }}
                >
                  <IconMic className="btn-icon" />
                  {settings.audio.calibrationOffsetDb > 0
                    ? 'Refazer calibração'
                    : 'Calibrar microfone'}
                </button>
                {settings.audio.calibrationOffsetDb > 0 && (
                  <button
                    className="btn ghost sm"
                    onClick={() =>
                      updateSettings(
                        { audio: { calibrationOffsetDb: 0, calibratedAt: null } },
                        { immediate: true },
                      )
                    }
                  >
                    Remover
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'interface' && (
        <div className="grid cols-2">
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--sp-4)' }}>
              Aparência
            </h3>
            <div className="stack" style={{ gap: 'var(--sp-4)' }}>
              <div className="field">
                <span className="label">Tema</span>
                <Segmented
                  value={settings.ui.theme}
                  onChange={(v) => updateSettings({ ui: { theme: v } })}
                  options={[
                    { id: 'escuro', label: 'Escuro' },
                    { id: 'claro', label: 'Claro' },
                    { id: 'sistema', label: 'Sistema' },
                  ]}
                />
              </div>
              <div className="field">
                <span className="label">Densidade do HUD</span>
                <Segmented
                  value={settings.ui.hudDensity}
                  onChange={(v) => updateSettings({ ui: { hudDensity: v } })}
                  options={[
                    { id: 'compacto', label: 'Compacto' },
                    { id: 'confortavel', label: 'Confortável' },
                    { id: 'amplo', label: 'Amplo' },
                  ]}
                />
              </div>
              <Slider
                label="Intensidade dos acentos"
                value={Math.round(settings.ui.accentIntensity * 100)}
                min={0}
                max={150}
                step={5}
                unit="%"
                onChange={(v) => updateSettings({ ui: { accentIntensity: v / 100 } })}
              />
              <Toggle
                label="Espectrograma no HUD"
                hint="Alternativa visual ao som — útil sem fones ou com baixa audição."
                checked={settings.ui.showSpectrogram}
                onChange={(v) => updateSettings({ ui: { showSpectrogram: v } })}
              />
              <Toggle
                label="Plano de formantes"
                checked={settings.ui.showFormants}
                onChange={(v) => updateSettings({ ui: { showFormants: v } })}
              />
              <Toggle
                label="Grade de notas no gráfico de altura"
                checked={settings.ui.showHarmonicGrid}
                onChange={(v) => updateSettings({ ui: { showHarmonicGrid: v } })}
              />
            </div>
          </div>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--sp-4)' }}>
              Idioma
            </h3>
            <div className="field">
              <span className="label">Idioma da interface</span>
              <select
                value={settings.ui.language}
                onChange={(e) =>
                  updateSettings({ ui: { language: e.target.value as 'pt-BR' | 'en' } })
                }
              >
                {AVAILABLE_LOCALES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
              <span className="hint">
                O conteúdo editorial (aulas, feedback, protocolo de avaliação) está em português
                nesta versão; o inglês cobre a interface. Ver docs/LIMITATIONS.md.
              </span>
            </div>
          </div>
        </div>
      )}

      {tab === 'acessibilidade' && (
        <div className="grid cols-2">
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--sp-4)' }}>
              {t('a11yTitle')}
            </h3>
            <div className="stack" style={{ gap: 'var(--sp-4)' }}>
              <Slider
                label={t('a11yFontScale')}
                value={Math.round(settings.ui.fontScale * 100)}
                min={85}
                max={160}
                step={5}
                unit="%"
                onChange={(v) => updateSettings({ ui: { fontScale: v / 100 } })}
              />
              <Toggle
                label={t('a11yHighContrast')}
                hint="Aumenta contraste de texto e bordas."
                checked={settings.ui.highContrast}
                onChange={(v) => updateSettings({ ui: { highContrast: v } })}
              />
              <Toggle
                label={t('a11yReducedMotion')}
                hint="Reduz animações e a taxa de atualização dos gráficos."
                checked={settings.ui.reducedMotion}
                onChange={(v) => updateSettings({ ui: { reducedMotion: v } })}
              />
              <Toggle
                label={t('a11yColorBlind')}
                hint="Troca rosa/azul por uma paleta âmbar/violeta discriminável em deuteranopia."
                checked={settings.ui.colorBlindSafe}
                onChange={(v) => updateSettings({ ui: { colorBlindSafe: v } })}
              />
            </div>
          </div>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
              Como o app funciona sem som
            </h3>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              <li style={{ marginBottom: 6 }}>
                Toda informação sonora tem equivalente visual: fita de altura, medidor de nível e
                espectrograma.
              </li>
              <li style={{ marginBottom: 6 }}>
                Nenhum exercício exige ouvir um retorno: as instruções são escritas e o feedback é
                numérico.
              </li>
              <li style={{ marginBottom: 6 }}>
                O tom de referência é opcional e pode ser desligado.
              </li>
              <li style={{ marginBottom: 6 }}>
                Os gráficos são navegáveis por leitor de tela via rótulos ARIA com os valores
                atuais.
              </li>
            </ul>
          </div>
        </div>
      )}

      {tab === 'privacidade' && (
        <div className="grid cols-2">
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
              {t('privacyTitle')}
            </h3>
            <div className="banner info" style={{ marginBottom: 'var(--sp-4)' }}>
              <span>{t('privacyLocal')}</span>
            </div>
            <div className="stack" style={{ gap: 'var(--sp-4)' }}>
              <Toggle
                label={t('privacyRecordings')}
                hint="Desligado: as sessões guardam apenas métricas, sem áudio."
                checked={settings.privacy.storeRecordings}
                onChange={(v) => updateSettings({ privacy: { storeRecordings: v } })}
              />
              <div className="field">
                <span className="label">{t('privacyRetention')}</span>
                <input
                  type="number"
                  min={0}
                  max={3650}
                  value={settings.privacy.retentionDays}
                  onChange={(e) =>
                    updateSettings({
                      privacy: { retentionDays: Math.max(0, Number(e.target.value) || 0) },
                    })
                  }
                />
                <span className="hint">0 = manter até você apagar manualmente.</span>
              </div>
              <div className="list-item">
                <IconLock size={15} style={{ color: 'var(--mint)' }} />
                <div style={{ flex: 1 }}>
                  <div className="list-title">{t('encryptedStorage')}</div>
                  <div className="list-meta">
                    {system?.keyProtected
                      ? 'Chave protegida pelo cofre do sistema operacional.'
                      : system?.dataDir?.includes('IndexedDB')
                        ? 'Modo navegador: sem criptografia.'
                        : 'Chave local com permissão 0600 (cofre do SO indisponível).'}
                  </div>
                </div>
              </div>
              <div className="list-item">
                <div style={{ flex: 1 }}>
                  <div className="list-title">Telemetria</div>
                  <div className="list-meta">
                    Desativada de forma permanente — o app não faz requisições de rede.
                  </div>
                </div>
                <span className="chip ok tiny">off</span>
              </div>
            </div>
          </div>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
              Controle total
            </h3>
            <p className="hint">
              Apagar dados é irreversível. Se quiser guardar um histórico sem áudio, exporte um
              backup em Dados antes.
            </p>
            <div className="row" style={{ marginTop: 'var(--sp-4)' }}>
              <button className="btn danger" onClick={() => setConfirmWipe(true)}>
                {t('privacyDeleteAll')}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'dados' && (
        <div className="grid cols-2">
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
              Backup e exportação
            </h3>
            <div className="stack" style={{ gap: 'var(--sp-3)' }}>
              <button className="btn" onClick={() => void exportBackup()}>
                <IconDownload className="btn-icon" /> Exportar backup (JSON, sem áudio)
              </button>
              <button className="btn" onClick={() => void importBackup()}>
                <IconUpload className="btn-icon" /> Importar backup
              </button>
              <p className="hint">
                O backup contém perfil, sessões, diário, metas e configurações — nunca gravações. A
                importação substitui os dados atuais após confirmação.
              </p>
            </div>
          </div>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
              Informações técnicas
            </h3>
            <div className="list">
              {[
                ['Versão do app', system?.appVersion ?? '1.0.0'],
                ['Electron / Chrome', `${system?.electron ?? '—'} / ${system?.chrome ?? '—'}`],
                ['Plataforma', `${system?.platform ?? '—'} ${system?.arch ?? ''}`],
                ['Diretório de dados', system?.dataDir || '—'],
                ['Gravações', `${data.recordings.length} arquivo(s)`],
                ['Sessões', `${data.sessions.length}`],
              ].map(([k, v]) => (
                <div className="list-item" key={k}>
                  <span className="small faint" style={{ width: 160 }}>
                    {k}
                  </span>
                  <span className="small mono" style={{ flex: 1, wordBreak: 'break-all' }}>
                    {v}
                  </span>
                </div>
              ))}
            </div>
            {system?.dataDir && (
              <p className="hint" style={{ marginTop: 'var(--sp-3)' }}>
                Os logs técnicos ficam em <span className="mono">logs/</span> dentro do diretório de
                dados e não contêm áudio nem conteúdo do diário.
              </p>
            )}
          </div>
        </div>
      )}

      {tab === 'sobre' && (
        <div className="grid cols-2">
          <div className="card">
            <div className="row" style={{ gap: 'var(--sp-4)', marginBottom: 'var(--sp-4)' }}>
              <LogoMark size={64} />
              <div>
                <h2 className="h2" style={{ fontSize: 'var(--fs-xl)' }}>
                  Prisma Vocal
                </h2>
                <p className="small faint">versão {system?.appVersion ?? '1.0.0'} · licença MIT</p>
              </div>
            </div>
            <p className="small muted">
              Ferramenta de treinamento, análise e acompanhamento vocal para pessoas trans e
              qualquer pessoa que queira explorar a própria voz. Processamento 100% local, sem
              contas, sem nuvem, sem telemetria.
            </p>
            <div className="divider" />
            <p className="small muted" style={{ marginBottom: 'var(--sp-2)' }}>
              <strong style={{ color: 'var(--text)' }}>Limites importantes:</strong> as medidas são
              estimativas acústicas para acompanhar sua evolução. Não são diagnóstico, não avaliam
              saúde vocal e não determinam como outras pessoas percebem sua voz.
            </p>
            <p className="hint">
              Se houver dor, rouquidão por mais de duas semanas, perda de extensão ou fadiga vocal
              constante, procure avaliação de fonoaudiólogo(a) ou médico(a).
            </p>
            <div className="row" style={{ marginTop: 'var(--sp-4)' }}>
              <button
                className="btn sm"
                onClick={() => openExternal('https://github.com/yuki-dev-bit')}
              >
                <IconGithub className="btn-icon" /> github.com/yuki-dev-bit
              </button>
            </div>
            <p className="tiny faint" style={{ marginTop: 'var(--sp-4)' }}>
              Feito por yuki-dev-bit · © {new Date().getFullYear()} · distribuído sob licença MIT
            </p>
          </div>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: 'var(--sp-3)' }}>
              Fundamentos técnicos
            </h3>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
              <li style={{ marginBottom: 8 }}>
                <strong style={{ color: 'var(--text)' }}>F0</strong>: YIN (de Cheveigné & Kawahara,
                2002), com função de diferença acelerada por FFT e correção conservadora de
                subharmônicos.
              </li>
              <li style={{ marginBottom: 8 }}>
                <strong style={{ color: 'var(--text)' }}>Formantes</strong>: LPC por autocorrelação
                + Levinson-Durbin, envelope com picos validados por largura de banda.
              </li>
              <li style={{ marginBottom: 8 }}>
                <strong style={{ color: 'var(--text)' }}>HNR</strong>: método de autocorrelação
                (linha de Boersma).
              </li>
              <li style={{ marginBottom: 8 }}>
                <strong style={{ color: 'var(--text)' }}>Ressonância</strong>: índice próprio
                combinando centroide normalizado pela f0 e energia de presença (2–4 kHz). Comparável
                apenas com você mesmo.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Soprosidade</strong>: estimativa perceptiva
                derivada de HNR, inclinação espectral, planura e aperiodicidade.
              </li>
            </ul>
          </div>
        </div>
      )}

      {confirmWipe && (
        <Modal
          title={t('privacyDeleteAll')}
          onClose={() => setConfirmWipe(false)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setConfirmWipe(false)}>
                {t('cancel')}
              </button>
              <button
                className="btn danger"
                onClick={async () => {
                  setConfirmWipe(false);
                  await clearAll();
                }}
              >
                {t('privacyDeleteAll')}
              </button>
            </>
          }
        >
          <p className="small muted">{t('privacyDeleteAllWarn')}</p>
        </Modal>
      )}

      {calibrating && (
        <CalibrationDialog open={calibrating} onClose={() => setCalibrating(false)} />
      )}
    </div>
  );
}
