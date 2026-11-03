/**
 * Handlers de IPC com validação de entrada.
 *
 * Todo payload vindo do renderer é tratado como não confiável: validamos tipos,
 * limites de tamanho e formato antes de tocar em disco.
 */
import { app, BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  IPC,
  type IpcResult,
  type LoadDataResult,
  type RecordingPcm,
  type SystemInfo,
} from '../src/shared/ipc-contract';
import type { AppData, AppSettings, RecordingMeta } from '../src/shared/types';
import { migrateData } from '../src/core/storage/repository';
import { SecureStore } from './storage/SecureStore';
import { log } from './logger';
import { shouldFireReminder, type ReminderSchedule } from './reminder-schedule';

const MAX_PCM_BYTES = 48000 * 4 * 60 * 12; // 12 min de float32 mono a 48 kHz
const ALLOWED_EXTERNAL = new Set([
  'https://github.com/yuki-dev-bit',
  'https://github.com/yuki-dev-bit/prisma-vocal',
]);

export interface IpcContext {
  store: SecureStore;
  getWindow: () => BrowserWindow | null;
  storageInit: { keyProtected: boolean; warning?: string; dataDir: string };
}

const ok = <T>(data?: T): IpcResult<T> => ({ ok: true, data });
const fail = (error: string): IpcResult<never> => ({ ok: false, error });

function sanitizeMeta(raw: unknown): RecordingMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(m.id)) return null;
  if (typeof m.createdAt !== 'string' || Number.isNaN(Date.parse(m.createdAt))) return null;
  if (typeof m.durationSec !== 'number' || m.durationSec <= 0 || m.durationSec > 900) return null;
  if (typeof m.sampleRate !== 'number' || m.sampleRate < 8000 || m.sampleRate > 192000) return null;
  return {
    id: m.id,
    createdAt: m.createdAt,
    label: typeof m.label === 'string' ? m.label.slice(0, 120) : 'Gravação',
    kind: (typeof m.kind === 'string' ? m.kind : 'livre') as RecordingMeta['kind'],
    lessonId: typeof m.lessonId === 'string' ? m.lessonId.slice(0, 64) : undefined,
    durationSec: m.durationSec,
    sampleRate: m.sampleRate,
    encrypted: true,
    metrics: (m.metrics ?? null) as RecordingMeta['metrics'],
    tags: Array.isArray(m.tags) ? m.tags.filter((t) => typeof t === 'string').slice(0, 10) : [],
  };
}

export function registerIpc(ctx: IpcContext): void {
  /**
   * Só a janela principal pode chamar o IPC.
   *
   * Antes qualquer `webContents` do processo podia invocar `data:export-backup`,
   * `data:clear-all` etc. Com a CSP e a política de navegação atuais não há como
   * outra origem carregar, mas o processo principal não deve depender disso: um
   * iframe criado por engano (ou uma regressão de CSP) ganharia acesso ao disco.
   */
  const isTrustedSender = (event: IpcMainInvokeEvent): boolean => {
    const win = ctx.getWindow();
    if (!win || win.isDestroyed()) return false;
    return event.sender === win.webContents;
  };

  const handle = <A extends unknown[]>(
    channel: string,
    fn: (event: IpcMainInvokeEvent, ...args: A) => Promise<IpcResult<unknown>> | IpcResult<unknown>,
  ): void => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrustedSender(event)) {
        log('warn', 'Chamada de IPC de origem não autorizada', { channel });
        return fail('Origem não autorizada.');
      }
      return fn(event, ...(args as A));
    });
  };

  handle(IPC.loadData, async (): Promise<IpcResult<LoadDataResult>> => {
    try {
      const raw = await ctx.store.readJson();
      const { data, issues } = migrateData(raw);
      const warnings: string[] = [];
      if (ctx.storageInit.warning) warnings.push(ctx.storageInit.warning);
      if (!ctx.storageInit.keyProtected) {
        warnings.push(
          'A chave de criptografia não pôde ser protegida pelo cofre do sistema. As gravações continuam cifradas, mas a chave fica no disco com permissão restrita.',
        );
      }
      return ok({ data, issues, warnings });
    } catch (err) {
      log('error', 'Falha ao carregar dados', { error: (err as Error).message });
      return fail(
        'Não foi possível ler os dados locais. Um arquivo de backup pode estar disponível em Ajustes → Dados.',
      );
    }
  });

  handle(IPC.saveData, async (_e, data: AppData): Promise<IpcResult<{ savedAt: string }>> => {
    try {
      if (!data || typeof data !== 'object' || !Array.isArray(data.sessions)) {
        return fail('Estrutura de dados inválida.');
      }
      // Revalida no processo principal: o renderer não é fonte de verdade.
      const { data: clean } = migrateData(data);
      await ctx.store.writeJson(clean);
      return ok({ savedAt: new Date().toISOString() });
    } catch (err) {
      log('error', 'Falha ao salvar dados', { error: (err as Error).message });
      return fail('Não foi possível salvar os dados.');
    }
  });

  handle(
    IPC.saveRecording,
    async (
      _e,
      payload: { meta: unknown; pcm: ArrayBuffer; sampleRate: number },
    ): Promise<IpcResult<{ id: string }>> => {
      try {
        const meta = sanitizeMeta(payload?.meta);
        if (!meta) return fail('Metadados de gravação inválidos.');
        const buf = payload.pcm;
        if (!(buf instanceof ArrayBuffer) || buf.byteLength === 0) return fail('Áudio vazio.');
        if (buf.byteLength > MAX_PCM_BYTES)
          return fail('Gravação muito longa (limite de 12 minutos).');
        const samples = new Float32Array(buf);
        await ctx.store.saveRecording(meta.id, samples);
        return ok({ id: meta.id });
      } catch (err) {
        log('error', 'Falha ao salvar gravação', { error: (err as Error).message });
        return fail('Não foi possível salvar a gravação.');
      }
    },
  );

  handle(IPC.loadRecording, async (_e, id: string): Promise<IpcResult<RecordingPcm>> => {
    try {
      if (typeof id !== 'string') return fail('Identificador inválido.');
      const pcm = await ctx.store.readRecording(id);
      // `.slice()` garante um ArrayBuffer próprio (sem memória compartilhada)
      return ok({ pcm: pcm.slice().buffer });
    } catch (err) {
      log('warn', 'Falha ao ler gravação', { error: (err as Error).message });
      return fail('Não foi possível ler a gravação (arquivo ausente ou chave diferente).');
    }
  });

  handle(IPC.deleteRecording, async (_e, id: string): Promise<IpcResult> => {
    try {
      if (typeof id !== 'string') return fail('Identificador inválido.');
      await ctx.store.deleteRecording(id);
      return ok();
    } catch (err) {
      log('warn', 'Falha ao excluir gravação', { error: (err as Error).message });
      return fail('Não foi possível excluir o arquivo da gravação.');
    }
  });

  handle(
    IPC.exportRecordingWav,
    async (
      _e,
      payload: { id: string; sampleRate: number; suggestedName: string },
    ): Promise<IpcResult<{ path: string }>> => {
      const win = ctx.getWindow();
      if (!win) return fail('Janela indisponível.');
      const safeName = String(payload?.suggestedName ?? 'gravacao')
        .replace(/[^\w\-. ]/g, '_')
        .slice(0, 80);
      const res = await dialog.showSaveDialog(win, {
        title: 'Exportar gravação em WAV',
        defaultPath: path.join(app_downloads(), `${safeName}.wav`),
        filters: [{ name: 'Áudio WAV', extensions: ['wav'] }],
      });
      if (res.canceled || !res.filePath) return fail('Exportação cancelada.');
      try {
        const sr = Number(payload.sampleRate);
        if (!Number.isFinite(sr) || sr < 8000 || sr > 192000)
          return fail('Taxa de amostragem inválida.');
        await ctx.store.exportWav(payload.id, sr, res.filePath);
        return ok({ path: res.filePath });
      } catch (err) {
        log('error', 'Falha ao exportar WAV', { error: (err as Error).message });
        return fail('Não foi possível exportar o arquivo.');
      }
    },
  );

  handle(
    IPC.exportReport,
    async (
      _e,
      payload: { html: string; markdown: string; suggestedName: string },
    ): Promise<IpcResult<{ path: string }>> => {
      const win = ctx.getWindow();
      if (!win) return fail('Janela indisponível.');
      const safeName = String(payload?.suggestedName ?? 'relatorio')
        .replace(/[^\w\-. ]/g, '_')
        .slice(0, 80);
      const res = await dialog.showSaveDialog(win, {
        title: 'Salvar relatório',
        defaultPath: path.join(app_downloads(), safeName),
        filters: [
          { name: 'HTML', extensions: ['html'] },
          { name: 'Markdown', extensions: ['md'] },
        ],
      });
      if (res.canceled || !res.filePath) return fail('Exportação cancelada.');
      try {
        const isMd = res.filePath.toLowerCase().endsWith('.md');
        const content = isMd ? payload.markdown : payload.html;
        if (typeof content !== 'string' || content.length > 5_000_000)
          return fail('Conteúdo inválido.');
        await fs.writeFile(res.filePath, content, { encoding: 'utf8', mode: 0o600 });
        return ok({ path: res.filePath });
      } catch (err) {
        log('error', 'Falha ao exportar relatório', { error: (err as Error).message });
        return fail('Não foi possível salvar o relatório.');
      }
    },
  );

  handle(IPC.exportBackup, async (_e, provided?: unknown): Promise<IpcResult<{ path: string }>> => {
    const win = ctx.getWindow();
    if (!win) return fail('Janela indisponível.');
    const res = await dialog.showSaveDialog(win, {
      title: 'Exportar backup dos dados (JSON, sem áudio)',
      defaultPath: path.join(
        app_downloads(),
        `prisma-vocal-backup-${new Date().toISOString().slice(0, 10)}.json`,
      ),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath) return fail('Exportação cancelada.');
    try {
      // Prefere o estado em memória enviado pelo renderer: o disco pode estar
      // atrás por causa do debounce de gravação (backup "desatualizado").
      const source =
        provided &&
        typeof provided === 'object' &&
        Array.isArray((provided as { sessions?: unknown }).sessions)
          ? provided
          : await ctx.store.readJson();
      const { data } = migrateData(source);
      await fs.writeFile(res.filePath, JSON.stringify(data, null, 2), {
        encoding: 'utf8',
        mode: 0o600,
      });
      return ok({ path: res.filePath });
    } catch (err) {
      log('error', 'Falha ao exportar backup', { error: (err as Error).message });
      return fail('Não foi possível exportar o backup.');
    }
  });

  handle(IPC.importBackup, async (): Promise<IpcResult<{ data: AppData }>> => {
    const win = ctx.getWindow();
    if (!win) return fail('Janela indisponível.');
    const res = await dialog.showOpenDialog(win, {
      title: 'Importar backup (JSON)',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return fail('Importação cancelada.');
    try {
      const raw = await fs.readFile(res.filePaths[0], 'utf8');
      const { data, issues } = migrateData(JSON.parse(raw));
      if (issues.length) log('warn', 'Backup importado com ajustes', { issues });
      return ok({ data });
    } catch (err) {
      log('error', 'Falha ao importar backup', { error: (err as Error).message });
      return fail('Arquivo inválido ou inacessível.');
    }
  });

  handle(IPC.clearAllData, async (): Promise<IpcResult> => {
    const win = ctx.getWindow();
    if (!win) return fail('Janela indisponível.');
    const confirm = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancelar', 'Apagar tudo'],
      defaultId: 0,
      cancelId: 0,
      title: 'Apagar todos os dados',
      message: 'Apagar todos os dados deste dispositivo?',
      detail:
        'Gravações, sessões, diário, metas, perfil e configurações serão removidos. As gravações são apagadas do disco. Esta ação não pode ser desfeita.',
    });
    if (confirm.response !== 1) return fail('Operação cancelada.');
    try {
      await ctx.store.wipe();
      return ok();
    } catch (err) {
      log('error', 'Falha ao apagar dados', { error: (err as Error).message });
      return fail('Não foi possível apagar todos os arquivos.');
    }
  });

  handle(IPC.systemInfo, async (): Promise<IpcResult<SystemInfo>> => {
    return ok({
      // `app.getVersion()` é a versão real do pacote (package.json empacotado),
      // independente de NODE_ENV/npm_package_version existirem.
      appVersion: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      keyProtected: ctx.storageInit.keyProtected,
      dataDir: ctx.storageInit.dataDir,
      // Antes: `process.env.NODE_ENV !== 'development'`, que mentia em execuções
      // sem a variável (ex.: abrir o app pelo binário do Electron em testes).
      isPackaged: app.isPackaged,
    });
  });

  handle(IPC.setReminders, async (_e, settings: AppSettings['reminders']): Promise<IpcResult> => {
    try {
      if (!settings || typeof settings !== 'object') return fail('Configuração inválida.');
      reminderConfig = {
        enabled: Boolean(settings.enabled),
        time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(settings.time))
          ? String(settings.time)
          : '19:00',
        weekdays: Array.isArray(settings.weekdays)
          ? settings.weekdays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
          : [],
        message: String(settings.message ?? '').slice(0, 120),
      };
      return ok();
    } catch {
      return fail('Não foi possível configurar lembretes.');
    }
  });

  handle(IPC.openExternal, async (_e, url: string): Promise<IpcResult> => {
    if (typeof url !== 'string') return fail('URL inválida.');
    const clean = url.split('?')[0].replace(/\/+$/, '');
    if (!ALLOWED_EXTERNAL.has(clean) && !ALLOWED_EXTERNAL.has(url)) {
      log('warn', 'Tentativa de abrir URL fora da allowlist', { url: clean });
      return fail('URL não permitida.');
    }
    await shell.openExternal(url).catch(() => undefined);
    return ok();
  });

  handle(
    IPC.logError,
    async (
      _e,
      payload: { message: string; stack?: string; context?: string },
    ): Promise<IpcResult> => {
      log('error', `Erro na interface: ${String(payload?.message ?? '').slice(0, 500)}`, {
        stack: String(payload?.stack ?? '').slice(0, 1500),
        context: String(payload?.context ?? '').slice(0, 200),
      });
      return ok();
    },
  );
}

/* ------------------------- lembretes (agendador) ------------------------- */

export interface ReminderConfig extends ReminderSchedule {
  message: string;
}

let reminderConfig: ReminderConfig = { enabled: false, time: '19:00', weekdays: [], message: '' };
let lastFiredKey = '';
let timer: NodeJS.Timeout | null = null;

export function startReminderScheduler(send: (channel: string, payload: unknown) => void): void {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (!reminderConfig.enabled) return;
    // Comparar `HH:MM` por igualdade perdia o lembrete quando o computador
    // voltava da suspensão depois daquele minuto. A regra agora aceita atraso.
    const decision = shouldFireReminder(reminderConfig, new Date(), lastFiredKey);
    if (!decision.fire) return;
    lastFiredKey = decision.key;
    send(IPC.onReminder, { message: reminderConfig.message || 'Hora de praticar sua voz.' });
    log('info', 'Lembrete disparado', { lateMinutes: decision.lateMinutes });
  }, 20_000);
  timer.unref?.();
}

export function stopReminderScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/**
 * Pasta inicial dos diálogos de salvar.
 *
 * `app.getPath('downloads')` é a resposta correta em todos os sistemas: no
 * Windows respeita "Downloads" redirecionado (OneDrive, domínio corporativo) e
 * caminho localizado; no Linux respeita XDG. O código anterior montava
 * `~/Downloads` na mão e caía na pasta do usuário quando ela não existia.
 */
function app_downloads(): string {
  try {
    return app.getPath('downloads');
  } catch {
    return app.getPath('home');
  }
}
