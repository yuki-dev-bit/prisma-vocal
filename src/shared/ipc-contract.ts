/**
 * Contrato de IPC entre processo principal (Electron) e renderer.
 *
 * Regras:
 *  • o renderer NUNCA recebe acesso a `fs`, `child_process` ou `ipcRenderer`;
 *  • toda mensagem tem tipo explícito e resultado no formato `IpcResult`;
 *  • nenhum canal envia áudio para fora da máquina — só há gravação/leitura
 *    de arquivos locais, sempre iniciadas pelo usuário.
 */
import type { AppData, AppSettings, RecordingMeta, SessionRecord } from './types';

export const IPC = {
  loadData: 'data:load',
  saveData: 'data:save',
  saveRecording: 'rec:save',
  loadRecording: 'rec:load',
  deleteRecording: 'rec:delete',
  exportRecordingWav: 'rec:export-wav',
  exportReport: 'data:export-report',
  exportBackup: 'data:export-backup',
  importBackup: 'data:import-backup',
  clearAllData: 'data:clear-all',
  systemInfo: 'sys:info',
  setReminders: 'sys:reminders',
  openExternal: 'sys:open-external',
  logError: 'sys:log-error',
  onReminder: 'sys:reminder-fired',
  /** main → renderer: grave o que estiver pendente (fechamento da janela). */
  flushRequest: 'app:flush-request',
  /** renderer → main: terminei de gravar, pode fechar. */
  flushDone: 'app:flush-done',
} as const;

export interface IpcResult<T = void> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface LoadDataResult {
  data: AppData;
  issues: string[];
  warnings: string[];
}

/**
 * A taxa de amostragem NÃO vem do arquivo: ela está nos metadados da gravação
 * (`RecordingMeta.sampleRate`). O arquivo guarda apenas amostras float32 mono.
 */
export interface RecordingPcm {
  pcm: ArrayBuffer;
}

export interface SystemInfo {
  appVersion: string;
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  /** Se o armazenamento em disco está criptografado e a chave está protegida pelo SO. */
  keyProtected: boolean;
  dataDir: string;
  isPackaged: boolean;
}

/** API exposta ao renderer via `contextBridge` (window.prisma). */
export interface PrismaBridge {
  readonly runtime: 'electron';
  loadData(): Promise<IpcResult<LoadDataResult>>;
  saveData(data: AppData): Promise<IpcResult<{ savedAt: string }>>;
  saveRecording(payload: {
    meta: RecordingMeta;
    pcm: ArrayBuffer;
    sampleRate: number;
  }): Promise<IpcResult<{ id: string }>>;
  loadRecording(id: string): Promise<IpcResult<RecordingPcm>>;
  deleteRecording(id: string): Promise<IpcResult>;
  exportRecordingWav(id: string): Promise<IpcResult<{ path: string }>>;
  exportReport(payload: {
    html: string;
    markdown: string;
    suggestedName: string;
  }): Promise<IpcResult<{ path: string }>>;
  /**
   * O renderer envia o estado em memória: o disco pode estar 450 ms atrás
   * (debounce) e o backup precisa refletir o que o usuário está vendo.
   */
  exportBackup(data?: unknown): Promise<IpcResult<{ path: string }>>;
  importBackup(): Promise<IpcResult<{ data: AppData }>>;
  clearAllData(): Promise<IpcResult>;
  systemInfo(): Promise<IpcResult<SystemInfo>>;
  setReminders(settings: AppSettings['reminders']): Promise<IpcResult>;
  openExternal(url: string): Promise<IpcResult>;
  logError(payload: { message: string; stack?: string; context?: string }): Promise<IpcResult>;
  onReminder(cb: () => void): () => void;
  /** Pede descarga dos dados ao renderer antes de fechar a janela. */
  onFlushRequest(cb: () => void): () => void;
  /** Confirma ao processo principal que a descarga terminou. */
  flushDone(): void;
}

/** Eventos que o processo principal pode emitir para a UI. */
export interface ReminderEvent {
  message: string;
}

export interface StorageWarningEvent {
  message: string;
}

export interface SaveSessionPayload {
  session: SessionRecord;
}
