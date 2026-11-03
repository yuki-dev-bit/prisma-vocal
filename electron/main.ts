/**
 * Processo principal do Electron.
 *
 * Responsabilidades: janela, permissões, CSP, armazenamento seguro, IPC,
 * lembretes e recuperação de falhas. Nenhuma lógica de DSP roda aqui — o
 * áudio é analisado no renderer (Web Audio + AudioWorklet) para ter a menor
 * latência possível, e nunca sai da máquina.
 */
import {
  app,
  BrowserWindow,
  Notification,
  ipcMain,
  screen,
  session,
  shell,
  dialog,
} from 'electron';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { registerIpc, startReminderScheduler, stopReminderScheduler } from './ipc';
import { SecureStore } from './storage/SecureStore';
import { closeLogger, log } from './logger';
import { IPC } from '../src/shared/ipc-contract';
import {
  effectiveMinSize,
  fitToWorkArea,
  parseWindowState,
  type WindowState,
} from './window-state';
import { createCloseGate } from './close-flush';

const isDev = process.env.NODE_ENV === 'development' || !!process.env.VITE_DEV_SERVER_URL;
// O bundle final é CJS (esbuild), então `__dirname` existe em tempo de execução.
// Declarado aqui para o typechecker (o tsconfig usa module: CommonJS sem @types/node global).
declare const __dirname: string;
const baseDir = __dirname;

let mainWindow: BrowserWindow | null = null;
let windowState: WindowState | null = null;
let saveStateTimer: NodeJS.Timeout | null = null;
const closeGate = createCloseGate(1500);
const STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');
let store: SecureStore | null = null;
let storageInit: { keyProtected: boolean; warning?: string; dataDir: string } = {
  keyProtected: false,
  dataDir: '',
};

// Produção: política estrita, sem inline, sem eval.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Desenvolvimento: o Vite injeta o preâmbulo do React Refresh como script
 * inline e usa WebSocket para o HMR. Com a CSP de produção esses dois recursos
 * são bloqueados (a janela abre em branco com "can't detect preamble"), por
 * isso o dev server recebe uma política própria. O bundle de produção continua
 * usando a política estrita acima.
 */
const CSP_DEV = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
].join('; ');

/**
 * Lê a geometria salva e ajusta para o monitor atual. Devolve `null` quando o
 * arquivo não existe/está corrompido (aí a janela abre centralizada no padrão).
 */
async function loadWindowState(): Promise<WindowState> {
  const { workArea } = screen.getPrimaryDisplay();
  try {
    const raw = await fs.readFile(STATE_FILE(), 'utf8');
    return fitToWorkArea(parseWindowState(JSON.parse(raw)), workArea);
  } catch {
    return fitToWorkArea(null, workArea);
  }
}

function persistWindowState(win: BrowserWindow): void {
  if (saveStateTimer) clearTimeout(saveStateTimer);
  // `move`/`resize` disparam dezenas de vezes por segundo ao arrastar.
  saveStateTimer = setTimeout(() => {
    saveStateTimer = null;
    if (win.isDestroyed() || win.isMinimized()) return;
    const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    const state = { bounds, maximized: win.isMaximized() };
    windowState = state;
    void fs
      .writeFile(STATE_FILE(), JSON.stringify(state), { mode: 0o600 })
      .catch((err: Error) =>
        log('warn', 'Não foi possível salvar a geometria da janela', { error: err.message }),
      );
  }, 500);
  saveStateTimer.unref?.();
}

function createWindow(): void {
  const { workArea } = screen.getPrimaryDisplay();
  const initial = windowState ?? fitToWorkArea(null, workArea);
  const minSize = effectiveMinSize(workArea);

  mainWindow = new BrowserWindow({
    x: initial.bounds.x,
    y: initial.bounds.y,
    width: initial.bounds.width,
    height: initial.bounds.height,
    minWidth: minSize.width,
    minHeight: minSize.height,
    show: false,
    backgroundColor: '#0b0d12',
    title: 'Prisma Vocal',
    icon: path.join(baseDir, '..', 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(baseDir, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      // AudioWorklet + getUserMedia precisam de autoplay liberado
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  if (initial.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Lembra tamanho, posição e estado maximizado entre execuções.
  const onGeometryChange = (): void => {
    if (mainWindow) persistWindowState(mainWindow);
  };
  mainWindow.on('resize', onGeometryChange);
  mainWindow.on('move', onGeometryChange);
  mainWindow.on('maximize', onGeometryChange);
  mainWindow.on('unmaximize', onGeometryChange);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (isDev && devUrl) {
    mainWindow.loadURL(devUrl).catch((err: Error) => {
      log('error', 'Falha ao carregar o dev server', { url: devUrl, error: err.message });
      dialog.showErrorBox(
        'Não foi possível abrir a interface',
        `O dev server (${devUrl}) não respondeu.\n\n` +
          'Deixe o terminal do `npm run dev` aberto e tente novamente. ' +
          'Se o problema continuar, rode `npm run doctor`.',
      );
    });
  } else {
    mainWindow.loadFile(path.join(baseDir, '..', 'dist', 'index.html')).catch((err: Error) => {
      log('error', 'Falha ao carregar dist/index.html', { error: err.message });
      dialog.showErrorBox(
        'Interface não encontrada',
        'A pasta dist/ está ausente ou incompleta. Rode `npm run build` (ou use o instalador).',
      );
    });
  }

  // Falhas de carregamento nunca devem virar uma janela em branco sem explicação.
  mainWindow.webContents.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* ABORTED: recarga normal */) return;
    log('error', 'did-fail-load', { code, description, url });
    dialog.showErrorBox(
      'Não foi possível carregar a interface',
      `${description} (código ${code})\n${url}\n\n` +
        'Em desenvolvimento: confirme que o Vite está rodando (npm run dev) e que a porta 5273 está livre.',
    );
  });

  // Em desenvolvimento, espelha o console do renderer no terminal: qualquer erro
  // de CSP ou de módulo aparece no lugar em que você está olhando.
  if (isDev) {
    mainWindow.webContents.on('console-message', (...args: unknown[]) => {
      const evt = args[0] as { message?: unknown; level?: unknown; lineNumber?: unknown };
      const message = typeof evt?.message === 'string' ? evt.message : String(args[1] ?? '');
      const level =
        typeof evt?.level === 'number' || typeof evt?.level === 'string' ? evt.level : args[2];
      console.log(`[renderer:${String(level)}] ${message}`);
    });
    mainWindow.webContents.on('did-finish-load', () => {
      void mainWindow?.webContents
        .executeJavaScript('document.getElementById("root")?.children.length ?? -1')
        .then((n: number) =>
          console.log(`[dev] interface montada: ${n > 0 ? 'sim' : 'NÃO'} (${n} nós em #root)`),
        )
        .catch(() => undefined);
    });
  }

  // Navegação: nada sai do app. Links externos só via allowlist (openExternal).
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env.VITE_DEV_SERVER_URL;
    if (devServer && url.startsWith(devServer)) return;
    event.preventDefault();
    log('warn', 'Navegação bloqueada', { url: url.slice(0, 200) });
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/github\.com\/yuki-dev-bit(\/|$)/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log('error', 'Renderer encerrado inesperadamente', { reason: details.reason });
    dialog
      .showMessageBox({
        type: 'error',
        title: 'Prisma Vocal',
        message: 'A interface precisou ser reiniciada.',
        detail:
          'Seus dados salvos não foram afetados. O aplicativo será recarregado — se o problema se repetir, exporte um backup e reabra.',
        buttons: ['Recarregar', 'Sair'],
      })
      .then((r) => {
        if (r.response === 0) mainWindow?.reload();
        else app.quit();
      });
  });

  mainWindow.webContents.on('unresponsive', () => {
    log('warn', 'Janela não responsiva');
    if (!mainWindow) return;
    void dialog
      .showMessageBox(mainWindow, {
        type: 'warning',
        title: 'Prisma Vocal',
        message: 'A interface está demorando para responder.',
        detail:
          'Isso costuma acontecer durante uma captura longa ou logo após abrir o aplicativo. Seus dados salvos não foram afetados.',
        buttons: ['Continuar esperando', 'Recarregar interface'],
        defaultId: 0,
        cancelId: 0,
      })
      .then((r) => {
        if (r.response === 1) mainWindow?.reload();
      });
  });

  // Defesa em profundidade: o app não usa <webview>. Se algum aparecer, é negado.
  mainWindow.webContents.on('will-attach-webview', (event) => {
    log('warn', 'Tentativa de anexar webview bloqueada');
    event.preventDefault();
  });

  /**
   * Fechamento em duas etapas: pede ao renderer para gravar o que está pendente
   * (o debounce de 450 ms pode ter a última alteração só na memória) e espera a
   * confirmação, com prazo de 1,5 s para nunca pendurar o app.
   */
  mainWindow.on('close', (event) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!closeGate.isArmed) {
      event.preventDefault();
      const wait = closeGate.request();
      if (mainWindow.webContents.isDestroyed()) {
        closeGate.ack();
      } else {
        log('info', 'Fechando: aguardando descarga dos dados pendentes');
        mainWindow.webContents.send(IPC.flushRequest);
      }
      void wait?.then(() => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      });
      return;
    }
    // Segunda passagem (ou app.quit() em andamento): deixa fechar.
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (saveStateTimer) clearTimeout(saveStateTimer);
  });

  ipcMain.removeAllListeners(IPC.flushDone);
  ipcMain.on(IPC.flushDone, () => closeGate.ack());
}

function configureSession(): void {
  const ses = session.defaultSession;

  // CSP aplicada a todas as respostas (funciona também em file:// via header).
  const activeCsp = isDev ? CSP_DEV : CSP;
  if (isDev) log('info', 'CSP de desenvolvimento ativa (HMR + preâmbulo do React Refresh)');

  ses.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [activeCsp],
        'X-Content-Type-Options': ['nosniff'],
      },
    });
  });

  /**
   * Permissões: apenas microfone — e apenas para a própria interface.
   *
   * Antes o handler liberava `media` para qualquer `webContents`, sem olhar a
   * origem do pedido. Com a política atual nada mais é carregado, mas conceder
   * microfone a uma origem desconhecida é o tipo de permissão que não se deve
   * deixar "aberta por padrão" (defesa em profundidade).
   */
  const devServer = process.env.VITE_DEV_SERVER_URL;
  const isOwnInterface = (url?: string): boolean => {
    if (!url) return false;
    if (devServer && url.startsWith(devServer)) return true;
    return url.startsWith('file://');
  };

  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    if (permission === 'media' && isOwnInterface(details?.requestingUrl)) return callback(true);
    log('warn', 'Permissão negada', {
      permission,
      url: String(details?.requestingUrl ?? '').slice(0, 120),
    });
    return callback(false);
  });
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return permission === 'media' && isOwnInterface(requestingOrigin);
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('br.dev.yukidev.prismavocal');
    configureSession();

    store = new SecureStore();
    try {
      storageInit = await store.init();
      if (storageInit.warning) log('warn', storageInit.warning);
    } catch (err) {
      log('error', 'Falha ao inicializar armazenamento', { error: (err as Error).message });
      dialog.showErrorBox(
        'Não foi possível preparar o armazenamento',
        'O aplicativo não conseguiu criar o cofre local. Verifique o espaço em disco e as permissões da pasta de dados.',
      );
    }

    registerIpc({
      store: store!,
      getWindow: () => mainWindow,
      storageInit,
    });

    startReminderScheduler((channel, payload) => {
      if (channel === IPC.onReminder) {
        const message = (payload as { message?: string })?.message ?? 'Hora de praticar sua voz.';
        mainWindow?.webContents.send(IPC.onReminder, { message });
        if (Notification.isSupported()) {
          new Notification({ title: 'Prisma Vocal', body: message, silent: false }).show();
        }
      }
    });

    windowState = await loadWindowState();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    stopReminderScheduler();
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', () => {
    stopReminderScheduler();
    closeLogger();
  });

  process.on('uncaughtException', (err) => {
    log('error', 'Exceção não tratada no processo principal', {
      error: err.message,
      stack: err.stack,
    });
    dialog.showErrorBox(
      'Ocorreu um erro inesperado',
      'O aplicativo registrou o erro em log local. Seus dados salvos permanecem intactos. Você pode continuar usando ou reiniciar.',
    );
  });
  process.on('unhandledRejection', (reason) => {
    log('error', 'Promessa rejeitada sem tratamento', { reason: String(reason).slice(0, 500) });
  });
}
