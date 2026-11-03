/**
 * Casca do aplicativo: navegação lateral, barra superior, faixas de aviso.
 * Aplica tema/acessibilidade no elemento raiz via data-attributes (CSS tokens).
 */
import { APP_VERSION } from '../shared/version';
import React, { useEffect, useState } from 'react';
import { useStore } from './state/store';
import { LogoMark, Wordmark } from './components/Logo';
import {
  IconBook,
  IconChart,
  IconClipboard,
  IconDisc,
  IconGithub,
  IconHome,
  IconJournal,
  IconSettings,
  IconWave,
} from './components/Icons';
import { HomeView } from './views/HomeView';
import { AnalyzeView } from './views/AnalyzeView';
import { TrainView } from './views/TrainView';
import { AssessView } from './views/AssessView';
import { RecordingsView } from './views/RecordingsView';
import { JournalView } from './views/JournalView';
import { ProgressView } from './views/ProgressView';
import { SettingsView } from './views/SettingsView';

export type ViewId =
  'home' | 'analyze' | 'train' | 'assess' | 'recordings' | 'journal' | 'progress' | 'settings';

type Section = {
  id: ViewId;
  labelKey: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  section: string;
};

const SECTIONS: Section[] = [
  { id: 'home', labelKey: 'navHome', icon: IconHome, section: 'Praticar' },
  { id: 'train', labelKey: 'navTrain', icon: IconBook, section: 'Praticar' },
  { id: 'analyze', labelKey: 'navAnalyze', icon: IconWave, section: 'Praticar' },
  { id: 'assess', labelKey: 'navAssess', icon: IconClipboard, section: 'Entender' },
  { id: 'progress', labelKey: 'navProgress', icon: IconChart, section: 'Entender' },
  { id: 'journal', labelKey: 'navJournal', icon: IconJournal, section: 'Entender' },
  { id: 'recordings', labelKey: 'navRecordings', icon: IconDisc, section: 'Acervo' },
  { id: 'settings', labelKey: 'navSettings', icon: IconSettings, section: 'Sistema' },
];

const TITLES: Record<ViewId, { title: string; sub: string }> = {
  home: { title: 'Início', sub: 'seu próximo passo, seu histórico' },
  analyze: { title: 'Analisar', sub: 'HUD de voz em tempo real e gravação de tomadas' },
  train: { title: 'Treinar', sub: 'módulos progressivos com metas proporcionais a você' },
  assess: { title: 'Avaliação', sub: 'mapeamento de tessitura, registros e ressonância' },
  recordings: { title: 'Gravações', sub: 'comparar, ouvir e exportar' },
  journal: { title: 'Diário vocal', sub: 'contexto subjetivo do seu treino' },
  progress: { title: 'Progresso', sub: 'evolução, metas e relatórios' },
  settings: { title: 'Configurações', sub: 'áudio, interface, acessibilidade e dados' },
};

export default function App() {
  const { settings, t, banners, dismissBanner, openExternal, ready, issues, data, setMode } =
    useStore();
  const [view, setView] = useState<ViewId>('home');
  const [pendingLesson, setPendingLesson] = useState<string | undefined>(undefined);

  /* aplica preferências visuais no <html> */
  useEffect(() => {
    const root = document.documentElement;
    const resolvedTheme =
      settings.ui.theme === 'sistema'
        ? window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'claro'
          : 'escuro'
        : settings.ui.theme;
    root.dataset.theme = resolvedTheme;
    root.dataset.contrast = settings.ui.highContrast ? 'high' : 'normal';
    root.dataset.cb = settings.ui.colorBlindSafe ? 'safe' : 'normal';
    root.dataset.motion = settings.ui.reducedMotion ? 'reduced' : 'normal';
    root.style.setProperty('--font-scale', String(settings.ui.fontScale));
    root.style.setProperty('--accent-strength', String(settings.ui.accentIntensity));
    document.documentElement.lang = settings.ui.language;
  }, [settings.ui]);

  const navigate = (next: ViewId, lessonId?: string) => {
    setPendingLesson(lessonId);
    setView(next);
  };

  if (!ready) {
    return (
      <div
        style={{
          display: 'grid',
          placeItems: 'center',
          height: '100%',
          color: 'var(--text-muted)',
        }}
      >
        <div className="row" style={{ gap: 12 }}>
          <LogoMark size={30} />
          <span>Carregando…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#conteudo">
        Pular para o conteúdo
      </a>
      <aside className="sidebar" aria-label="Navegação principal">
        <div className="brand">
          <LogoMark size={34} />
          <Wordmark />
        </div>

        <nav className="nav">
          {SECTIONS.map((s, index) => {
            const showSection = index === 0 || s.section !== SECTIONS[index - 1].section;
            const Icon = s.icon;
            return (
              <React.Fragment key={s.id}>
                {showSection && <div className="nav-section">{s.section}</div>}
                <button
                  className="nav-item"
                  aria-current={view === s.id ? 'page' : undefined}
                  onClick={() => navigate(s.id)}
                >
                  <Icon className="nav-icon" />
                  <span className="nav-label">{t(s.labelKey as never)}</span>
                  {s.id === 'journal' && data.journal.length > 0 && (
                    <span className="nav-badge">{data.journal.length}</span>
                  )}
                </button>
              </React.Fragment>
            );
          })}
        </nav>

        <div className="sidebar-foot">
          <div className="signature">
            <span>{t('madeBy')}</span>
            <button
              className="link-btn"
              onClick={() => openExternal('https://github.com/yuki-dev-bit')}
              aria-label="GitHub de yuki-dev-bit"
            >
              <IconGithub size={14} />
            </button>
          </div>
          <div className="tiny faint">v{APP_VERSION} · MIT · 100% local</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <div className="topbar-title">{TITLES[view].title}</div>
            <div className="topbar-sub">{TITLES[view].sub}</div>
          </div>
          <div className="topbar-spacer" />
          <div className="segmented" role="group" aria-label={t('modeLabel')}>
            <button aria-pressed={settings.mode === 'mtf'} onClick={() => setMode('mtf')}>
              {t('modeMtf')}
            </button>
            <button aria-pressed={settings.mode === 'ftm'} onClick={() => setMode('ftm')}>
              {t('modeFtm')}
            </button>
            <button aria-pressed={settings.mode === 'shared'} onClick={() => setMode('shared')}>
              {t('modeShared')}
            </button>
          </div>
        </header>

        <main className="content" id="conteudo">
          <div className="stack">
            {banners.map((b) => (
              <div
                key={b.id}
                className={`banner ${b.kind === 'danger' ? 'danger' : b.kind === 'info' ? 'info' : ''}`}
              >
                <span style={{ flex: 1 }}>{b.message}</span>
                <button
                  className="link-btn"
                  onClick={() => dismissBanner(b.id)}
                  aria-label="Dispensar aviso"
                >
                  fechar
                </button>
              </div>
            ))}
            {issues.length > 0 && (
              <div className="banner">
                <span style={{ flex: 1 }}>Avisos ao carregar dados: {issues.join(' ')}</span>
              </div>
            )}

            {view === 'home' && <HomeView onNavigate={navigate} />}
            {view === 'analyze' && <AnalyzeView />}
            {view === 'train' && (
              <TrainView
                initialLessonId={pendingLesson}
                onOpenAnalyze={() => navigate('analyze')}
              />
            )}
            {view === 'assess' && <AssessView onDone={() => navigate('train')} />}
            {view === 'recordings' && <RecordingsView />}
            {view === 'journal' && <JournalView />}
            {view === 'progress' && <ProgressView />}
            {view === 'settings' && <SettingsView />}
          </div>
        </main>
      </div>
    </div>
  );
}
