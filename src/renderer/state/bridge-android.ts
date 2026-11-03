/**
 * Armazenamento no Android (Capacitor).
 *
 * O renderer é o mesmo do desktop — muda apenas quem responde ao contrato
 * `StorageBridge`. Aqui a persistência é o IndexedDB do WebView, com dados e
 * gravações cifrados (AES-GCM, chave não-extraível; ver `crypto-box.ts`), e as
 * funções "de sistema" usam plugins nativos do Capacitor:
 *
 *  • exportar WAV / relatório / backup → grava no cache do app e abre a folha de
 *    compartilhamento do Android (Drive, WhatsApp, e-mail…);
 *  • lembretes → notificações locais agendadas, uma por dia da semana;
 *  • links externos → navegador do sistema.
 *
 * Importações dos plugins são dinâmicas para que o bundle web/desktop não
 * carregue código nativo que nunca será usado.
 */
import type { AppData, AppSettings, RecordingMeta } from '../../shared/types';
import { APP_VERSION } from '../../shared/version';
import type { SystemInfo } from '../../shared/ipc-contract';
import { migrateData } from '../../core/storage/repository';
import { decodeWav, encodeWav16, toMono } from '../../core/dsp/wav';
import type { LoadResult, StorageBridge } from './bridge';
import { idbClear, idbDelete, idbGet, idbPut, STORE_KV, STORE_REC } from './idb';
import {
  decryptArray,
  decryptJson,
  encryptArray,
  encryptJson,
  isEncryptionAvailable,
} from './crypto-box';

const DATA_KEY = 'app-data';
const DATA_ENC = 'app-data:enc';
type Stored = { iv: number[]; data: number[] };

/** Grava um arquivo no cache do app e abre o compartilhamento do sistema. */
async function shareFile(name: string, content: string, mime: string): Promise<string> {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const written = await Filesystem.writeFile({
    path: name,
    data: content,
    directory: Directory.Cache,
    encoding: mime.startsWith('text/') || mime === 'application/json' ? Encoding.UTF8 : undefined,
  });
  const uri = written.uri;
  try {
    await Share.share({ title: name, url: uri, dialogTitle: 'Compartilhar arquivo' });
  } catch {
    /* usuário cancelou ou o aparelho não tem folha de compartilhamento */
  }
  return uri;
}

async function shareBinary(name: string, base64OrBytes: string): Promise<string> {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const { Share } = await import('@capacitor/share');
  const written = await Filesystem.writeFile({
    path: name,
    data: base64OrBytes,
    directory: Directory.Cache,
  });
  try {
    await Share.share({ title: name, url: written.uri, dialogTitle: 'Compartilhar áudio' });
  } catch {
    /* idem */
  }
  return written.uri;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Abre o seletor de arquivos do Android e lê um JSON (importar backup). */
function pickJsonFile(): Promise<unknown | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    input.onchange = () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(JSON.parse(String(reader.result)));
        } catch (err) {
          reject(new Error(`Backup inválido: ${(err as Error).message}`));
        }
      };
      reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo'));
      reader.readAsText(file);
    };
    document.body.appendChild(input);
    input.click();
  });
}

async function scheduleReminders(settings: AppSettings['reminders']): Promise<void> {
  const { LocalNotifications } = await import('@capacitor/local-notifications');

  const permission = await LocalNotifications.requestPermissions();
  if (permission.display !== 'granted') {
    throw new Error('Permissão de notificação negada nas configurações do Android.');
  }

  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length > 0) {
    await LocalNotifications.cancel({
      notifications: pending.notifications.map((n) => ({ id: n.id })),
    });
  }
  if (!settings.enabled || settings.weekdays.length === 0) return;

  const [hour, minute] = settings.time.split(':').map(Number);
  const notifications = settings.weekdays.map((weekday, index) => ({
    id: 1000 + index,
    title: 'Prisma Vocal',
    body: settings.message || 'Hora de praticar sua voz.',
    schedule: { on: { weekday: weekday + 1, hour, minute }, repeats: true, allowWhileIdle: true },
    smallIcon: 'ic_stat_icon',
  }));

  await LocalNotifications.schedule({ notifications });
}

export function androidBridge(): StorageBridge {
  return {
    runtime: 'android',

    async loadData(): Promise<LoadResult> {
      try {
        const enc = await idbGet<Stored>(STORE_KV, DATA_ENC);
        if (enc) {
          const plain = await decryptJson<unknown>(enc);
          const { data, issues } = migrateData(plain);
          return { data, issues, warnings: [] };
        }
        // Instalação nova (ou vinda do modo navegador, sem criptografia ainda).
        const raw = await idbGet<unknown>(STORE_KV, DATA_KEY);
        const { data, issues } = migrateData(raw ?? null);
        if (raw) await idbDelete(STORE_KV, DATA_KEY);
        return { data, issues, warnings: [] };
      } catch (err) {
        return {
          data: migrateData(null).data,
          issues: [`Falha ao abrir o armazenamento local: ${(err as Error).message}`],
          warnings: [
            'Não foi possível abrir o cofre de dados neste aparelho. Seus dados anteriores não foram alterados.',
          ],
        };
      }
    },

    async saveData(data: AppData) {
      try {
        await idbPut(STORE_KV, DATA_ENC, await encryptJson(data));
        return { ok: true, data: { savedAt: new Date().toISOString() } };
      } catch (err) {
        return { ok: false, error: `Não foi possível salvar: ${(err as Error).message}` };
      }
    },

    async saveRecording(meta: RecordingMeta, pcm: Float32Array, sampleRate: number) {
      try {
        const wav = encodeWav16(pcm, sampleRate, 1);
        await idbPut(STORE_REC, meta.id, await encryptArray(wav));
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
        const stored = await idbGet<Stored>(STORE_REC, id);
        if (!stored) return { ok: false, error: 'Gravação não encontrada.' };
        const bytes = await decryptArray(stored);
        return { ok: true, data: toMono(decodeWav(bytes)) };
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
      try {
        const uri = await shareBinary(`${name}.wav`, bytesToBase64(wav));
        return { ok: true, data: { path: uri } };
      } catch (err) {
        return { ok: false, error: `Não foi possível exportar: ${(err as Error).message}` };
      }
    },

    async exportReport(payload) {
      const isMd = payload.suggestedName.endsWith('.md');
      const name = isMd ? payload.suggestedName : `${payload.suggestedName}.html`;
      try {
        const uri = await shareFile(
          name,
          isMd ? payload.markdown : payload.html,
          isMd ? 'text/markdown' : 'text/html',
        );
        return { ok: true, data: { path: uri } };
      } catch (err) {
        return { ok: false, error: `Não foi possível exportar: ${(err as Error).message}` };
      }
    },

    async exportBackup(data) {
      const name = `prisma-vocal-backup-${new Date().toISOString().slice(0, 10)}.json`;
      try {
        const uri = await shareFile(name, JSON.stringify(data, null, 2), 'application/json');
        return { ok: true, data: { path: uri } };
      } catch (err) {
        return { ok: false, error: `Não foi possível exportar: ${(err as Error).message}` };
      }
    },

    async importBackup() {
      try {
        const json = await pickJsonFile();
        if (!json) return { ok: false, error: 'Nenhum arquivo selecionado.' };
        const { data, issues } = migrateData(json);
        if (issues.length > 0) {
          return { ok: false, error: `Backup com problemas: ${issues.join('; ')}` };
        }
        return { ok: true, data: { data } };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },

    async clearAllData() {
      try {
        // Inclui a chave de criptografia: sem ela, o que sobrou é ilegível.
        await idbClear(STORE_KV);
        await idbClear(STORE_REC);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },

    async systemInfo(): Promise<SystemInfo> {
      return {
        appVersion: APP_VERSION,
        platform: 'android',
        arch: '—',
        electron: '—',
        chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] ?? '—',
        keyProtected: await isEncryptionAvailable(),
        dataDir: 'Armazenamento do app (IndexedDB, AES-GCM)',
        isPackaged: true,
      };
    },

    async setReminders(settings) {
      try {
        await scheduleReminders(settings);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },

    async openExternal(url) {
      // Mesma allowlist do processo principal do desktop: só o repositório do
      // projeto, e só por https. Evita transformar o app em abre-links genérico.
      if (!/^https:\/\/github\.com\/yuki-dev-bit(\/|$)/.test(url)) {
        return { ok: false, error: 'Link não permitido.' };
      }
      window.open(url, '_blank', 'noopener,noreferrer');
      return { ok: true };
    },

    async logError(payload) {
      console.error('[prisma]', payload.message, payload.stack ?? '', payload.context ?? '');
      return { ok: true };
    },

    onReminder() {
      // Android entrega pelo sistema (notificação), não por callback na UI.
      return () => undefined;
    },
  };
}
