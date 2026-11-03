/**
 * Camada de armazenamento vista pelo renderer.
 *
 * Existem três implementações:
 *  1. `electronBridge` — delega ao processo principal (armazenamento
 *     criptografado, gravações cifradas em disco, diálogos nativos);
 *  2. `androidBridge` — app Android (Capacitor): IndexedDB cifrado com
 *     AES-GCM, compartilhamento nativo e notificações locais;
 *  3. `browserBridge` — modo navegador/preview: IndexedDB local, SEM
 *     criptografia (a UI avisa isso explicitamente).
 *
 * A interface é a mesma, então nenhum componente sabe em qual modo está.
 */
import type { AppData, RecordingMeta } from '../../shared/types';
import type { IpcResult, PrismaBridge, SystemInfo } from '../../shared/ipc-contract';
import { migrateData } from '../../core/storage/repository';
import { decodeWav, encodeWav16, toMono } from '../../core/dsp/wav';
import { APP_VERSION } from '../../shared/version';
import { download, idbClear, idbDelete, idbGet, idbPut, STORE_KV, STORE_REC } from './idb';
import { androidBridge } from './bridge-android';

export interface LoadResult {
  data: AppData;
  issues: string[];
  warnings: string[];
}

export interface StorageBridge {
  readonly runtime: 'electron' | 'browser' | 'android';
  loadData(): Promise<LoadResult>;
  saveData(data: AppData): Promise<IpcResult<{ savedAt: string }>>;
  saveRecording(
    meta: RecordingMeta,
    pcm: Float32Array,
    sampleRate: number,
  ): Promise<IpcResult<{ id: string }>>;
  loadRecording(id: string): Promise<IpcResult<Float32Array>>;
  deleteRecording(id: string): Promise<IpcResult>;
  exportRecordingWav(
    id: string,
    sampleRate: number,
    name: string,
  ): Promise<IpcResult<{ path: string }>>;
  exportReport(payload: {
    html: string;
    markdown: string;
    suggestedName: string;
  }): Promise<IpcResult<{ path: string }>>;
  exportBackup(data: AppData): Promise<IpcResult<{ path: string }>>;
  importBackup(): Promise<IpcResult<{ data: AppData }>>;
  clearAllData(): Promise<IpcResult>;
  systemInfo(): Promise<SystemInfo>;
  setReminders(settings: AppData['settings']['reminders']): Promise<IpcResult>;
  openExternal(url: string): Promise<IpcResult>;
  logError(payload: { message: string; stack?: string; context?: string }): Promise<IpcResult>;
  onReminder(cb: () => void): () => void;
  /**
   * Só Electron: o processo principal pede a descarga dos dados antes de fechar
   * a janela (o debounce de gravação pode ter alterações só na memória).
   * Devolve a função de cancelamento.
   */
  onFlushRequest?(flush: () => Promise<void>): () => void;
}

declare global {
  interface Window {
    /**
     * Ponte do desktop. O tipo vem do contrato compartilhado — antes era uma
     * cópia manual aqui, que silenciosamente ficava desatualizada (foi o que
     * aconteceu com `exportBackup` e com os canais de descarga).
     */
    prisma?: PrismaBridge;
  }
}

/* ------------------------------------------------------------------ */
/* Electron                                                            */
/* ------------------------------------------------------------------ */

function electronBridge(): StorageBridge {
  const api = window.prisma!;
  return {
    runtime: 'electron',
    async loadData() {
      const res = await api.loadData();
      if (!res.ok || !res.data) {
        throw new Error(res.error ?? 'Falha ao carregar dados');
      }
      return res.data;
    },
    saveData: (data) => api.saveData(data),
    saveRecording: (meta, pcm, sampleRate) =>
      api.saveRecording({ meta, pcm: pcm.slice().buffer as ArrayBuffer, sampleRate }),
    async loadRecording(id) {
      const res = await api.loadRecording(id);
      if (!res.ok || !res.data) return { ok: false, error: res.error };
      return { ok: true, data: new Float32Array(res.data.pcm) };
    },
    deleteRecording: (id) => api.deleteRecording(id),
    // O processo principal exporta com a taxa dos metadados; `sampleRate` e
    // `name` só são usados pelo modo navegador.
    exportRecordingWav: (id) => api.exportRecordingWav(id),
    exportReport: (payload) => api.exportReport(payload),
    // Envia o estado em memória: o disco pode estar atrás por causa do debounce.
    exportBackup: (data) => api.exportBackup(data),
    importBackup: () => api.importBackup(),
    clearAllData: () => api.clearAllData(),
    async systemInfo() {
      const res = await api.systemInfo();
      return res.ok && res.data
        ? res.data
        : {
            appVersion: APP_VERSION,
            platform: 'unknown',
            arch: 'unknown',
            electron: '—',
            chrome: '—',
            keyProtected: false,
            dataDir: '',
            isPackaged: true,
          };
    },
    setReminders: (s) => api.setReminders(s),
    openExternal: (url) => api.openExternal(url),
    logError: (payload) => api.logError(payload),
    onReminder: (cb) => api.onReminder(cb),
    onFlushRequest(flush) {
      const api = window.prisma;
      if (!api) return () => undefined;
      return api.onFlushRequest(() => {
        // Confirma ao processo principal só depois da gravação terminar; se algo
        // falhar, ainda confirmamos — o fechamento não pode travar por isso.
        void Promise.resolve()
          .then(flush)
          .catch(() => undefined)
          .finally(() => api.flushDone());
      });
    },
  };
}

/* ------------------------------------------------------------------ */
/* Navegador (modo local, sem criptografia)                            */
/* ------------------------------------------------------------------ */

function browserBridge(): StorageBridge {
  const DATA_KEY = 'app-data';
  return {
    runtime: 'browser',
    async loadData() {
      try {
        const raw = await idbGet<unknown>(STORE_KV, DATA_KEY);
        const { data, issues } = migrateData(raw);
        return {
          data,
          issues,
          warnings: [
            'Modo navegador: os dados ficam no armazenamento local deste navegador, sem criptografia. Use a versão desktop para armazenamento cifrado.',
          ],
        };
      } catch (err) {
        return {
          data: migrateData(null).data,
          issues: [`Falha ao ler armazenamento local: ${(err as Error).message}`],
          warnings: ['Não foi possível acessar o IndexedDB; os dados não serão persistidos.'],
        };
      }
    },
    async saveData(data) {
      try {
        await idbPut(STORE_KV, DATA_KEY, data);
        return { ok: true, data: { savedAt: new Date().toISOString() } };
      } catch (err) {
        return { ok: false, error: `Não foi possível salvar: ${(err as Error).message}` };
      }
    },
    async saveRecording(meta, pcm, sampleRate) {
      try {
        // Guarda WAV em vez de float32 cru: legível para debug local e
        // reproduzível no <audio>. NÃO é criptografado neste modo.
        const wav = encodeWav16(pcm, sampleRate, 1);
        await idbPut(STORE_REC, meta.id, new Blob([wav.slice().buffer], { type: 'audio/wav' }));
        await idbPut(STORE_REC, `${meta.id}:meta`, { sampleRate });
        return { ok: true, data: { id: meta.id } };
      } catch (err) {
        return {
          ok: false,
          error: `Não foi possível salvar a gravação: ${(err as Error).message}`,
        };
      }
    },
    async loadRecording(id) {
      try {
        const blob = await idbGet<Blob>(STORE_REC, id);
        if (!blob) return { ok: false, error: 'Gravação não encontrada.' };
        const buf = await blob.arrayBuffer();
        const decoded = decodeWav(new Uint8Array(buf));
        return { ok: true, data: toMono(decoded) };
      } catch (err) {
        return { ok: false, error: `Falha ao ler gravação: ${(err as Error).message}` };
      }
    },
    async deleteRecording(id) {
      try {
        await idbDelete(STORE_REC, id);
        await idbDelete(STORE_REC, `${id}:meta`);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
    async exportRecordingWav(id, sampleRate, name) {
      const res = await this.loadRecording(id);
      if (!res.ok || !res.data) return { ok: false, error: res.error };
      const wav = encodeWav16(res.data, sampleRate, 1);
      return {
        ok: true,
        data: {
          path: download(new Blob([wav.slice().buffer], { type: 'audio/wav' }), `${name}.wav`),
        },
      };
    },
    async exportReport(payload) {
      const name = payload.suggestedName.endsWith('.md')
        ? payload.suggestedName
        : `${payload.suggestedName}.html`;
      const content = name.endsWith('.md') ? payload.markdown : payload.html;
      const type = name.endsWith('.md') ? 'text/markdown' : 'text/html';
      return { ok: true, data: { path: download(new Blob([content], { type }), name) } };
    },
    async exportBackup(data) {
      const json = JSON.stringify(data, null, 2);
      return {
        ok: true,
        data: {
          path: download(
            new Blob([json], { type: 'application/json' }),
            `prisma-vocal-backup-${new Date().toISOString().slice(0, 10)}.json`,
          ),
        },
      };
    },
    async importBackup() {
      return { ok: false, error: 'Importação de backup está disponível apenas na versão desktop.' };
    },
    async clearAllData() {
      try {
        await idbClear(STORE_KV);
        await idbClear(STORE_REC);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
    async systemInfo() {
      return {
        appVersion: APP_VERSION,
        platform: navigator.platform || 'web',
        arch: '—',
        electron: '—',
        chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '—',
        keyProtected: false,
        dataDir: 'IndexedDB (navegador)',
        isPackaged: false,
      };
    },
    async setReminders() {
      return {
        ok: false,
        error: 'Lembretes do sistema estão disponíveis apenas na versão desktop.',
      };
    },
    async openExternal(url) {
      window.open(url, '_blank', 'noopener,noreferrer');
      return { ok: true };
    },
    async logError(payload) {
      console.error('[prisma]', payload.message, payload.stack ?? '', payload.context ?? '');
      return { ok: true };
    },
    onReminder() {
      return () => undefined;
    },
  };
}

/** `true` quando o app roda dentro do Capacitor (Android/iOS), não no navegador. */
export function isNativeRuntime(): boolean {
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

let cached: StorageBridge | null = null;

export function getBridge(): StorageBridge {
  if (cached) return cached;
  if (window.prisma) cached = electronBridge();
  else if (isNativeRuntime()) cached = androidBridge();
  else cached = browserBridge();
  return cached;
}

export function isElectronRuntime(): boolean {
  return Boolean(window.prisma);
}
