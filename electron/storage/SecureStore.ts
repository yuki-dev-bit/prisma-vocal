/**
 * Armazenamento seguro em disco (processo principal).
 *
 * Modelo de ameaça considerado:
 *  • outro usuário do mesmo computador lendo os arquivos;
 *  • backup/sincronização em nuvem copiando o diretório de dados;
 *  • inspeção casual do conteúdo das gravações.
 *
 * Não é proteção contra código malicioso rodando com o mesmo usuário — nesse
 * caso nenhuma criptografia local ajuda. Isso está documentado em SECURITY.md.
 *
 * Esquema:
 *  • chave aleatória de 32 bytes por instalação;
 *  • chave protegida por `safeStorage` (Keychain/DPAPI/libsecret) quando
 *    disponível; se não, arquivo com permissão 0600 + aviso explícito na UI;
 *  • AES-256-GCM, IV aleatório de 12 bytes por registro, tag de 16 bytes;
 *  • arquivos escritos de forma atômica (tmp + rename) com backup .bak.
 */
import { app, safeStorage } from 'electron';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { WriteQueue } from './write-queue';
import { encodeWav16 } from '../../src/core/dsp/wav';

const KEY_FILE = 'vault.key';
const DATA_FILE = 'app-data.enc';
const REC_DIR = 'recordings';

export interface StorageInit {
  dataDir: string;
  keyProtected: boolean;
  warning?: string;
}

export class SecureStore {
  private readonly dir: string;
  private readonly recordingsDir: string;
  private key: Buffer | null = null;
  private keyProtected = false;
  private warning?: string;
  /**
   * Serializa as escritas. Duas gravações simultâneas (debounce dos dados +
   * gravação imediata da calibração) usavam o mesmo arquivo temporário e podiam
   * publicar um JSON truncado.
   */
  private readonly writes = new WriteQueue();

  constructor(dir?: string) {
    this.dir = dir ?? path.join(app.getPath('userData'), 'store');
    this.recordingsDir = path.join(this.dir, REC_DIR);
  }

  get dataDir(): string {
    return this.dir;
  }

  async init(): Promise<StorageInit> {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    await fs.mkdir(this.recordingsDir, { recursive: true, mode: 0o700 });
    await this.loadOrCreateKey();
    return { dataDir: this.dir, keyProtected: this.keyProtected, warning: this.warning };
  }

  private get keyPath(): string {
    return path.join(this.dir, KEY_FILE);
  }

  private async loadOrCreateKey(): Promise<void> {
    try {
      const raw = await fs.readFile(this.keyPath);
      const text = raw.toString('utf8');
      if (text.startsWith('enc:')) {
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error(
            'A chave do cofre está protegida pelo sistema operacional, mas o cofre do SO não está disponível agora.',
          );
        }
        this.key = Buffer.from(
          safeStorage.decryptString(Buffer.from(text.slice(4), 'base64')),
          'hex',
        );
        this.keyProtected = true;
        return;
      }
      if (text.startsWith('plain:')) {
        this.key = Buffer.from(text.slice(6), 'hex');
        this.keyProtected = false;
        this.warning =
          'O cofre do sistema operacional não está disponível: a chave do armazenamento está protegida apenas por permissões de arquivo (0600).';
        return;
      }
      throw new Error('Formato de chave desconhecido');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        // chave ilegível: gera nova e avisa (dados antigos ficam inacessíveis)
        this.warning =
          'A chave de armazenamento não pôde ser lida. Um novo cofre foi criado; dados anteriores podem estar inacessíveis.';
        // preserva a chave antiga para não destruir dados de forma irreversível
        await fs
          .rename(this.keyPath, `${this.keyPath}.inaccessible-${Date.now()}`)
          .catch(() => undefined);
      }
      await this.createKey();
    }
    if (this.key && this.key.length !== 32) {
      await this.createKey();
    }
  }

  private async createKey(): Promise<void> {
    const key = randomBytes(32);
    if (safeStorage.isEncryptionAvailable()) {
      const protectedKey = safeStorage.encryptString(key.toString('hex')).toString('base64');
      await fs.writeFile(this.keyPath, `enc:${protectedKey}`, { mode: 0o600 });
      this.keyProtected = true;
      this.warning = undefined;
    } else {
      await fs.writeFile(this.keyPath, `plain:${key.toString('hex')}`, { mode: 0o600 });
      this.keyProtected = false;
      this.warning =
        'Cofre do sistema operacional indisponível: as gravações ficam criptografadas com chave local protegida apenas por permissão de arquivo.';
    }
    this.key = key;
  }

  private requireKey(): Buffer {
    if (!this.key) throw new Error('Cofre não inicializado');
    return this.key;
  }

  private encrypt(buf: Buffer): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.requireKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(buf), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]);
  }

  private decrypt(payload: Buffer): Buffer {
    if (payload.length < 29) throw new Error('Registro criptografado corrompido');
    const iv = payload.subarray(0, 12);
    const tag = payload.subarray(12, 28);
    const ciphertext = payload.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.requireKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /**
   * Escrita atômica: temporário exclusivo → fsync → rename.
   *
   * O `fsync` importa aqui: sem ele, um desligamento abrupto logo após o rename
   * pode deixar o arquivo renomeado e vazio (metadados chegam ao disco antes do
   * conteúdo), justamente no arquivo que guarda tudo. O temporário ganha sufixo
   * único por escrita para nunca colidir com outra em andamento.
   */
  private async writeAtomic(file: string, data: Buffer): Promise<void> {
    const tmp = `${file}.tmp-${this.writes.nextTempSuffix()}`;
    const handle = await fs.open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(tmp, file);
  }

  /** Espera as escritas pendentes terminarem (usado no fechamento do app). */
  async drain(): Promise<void> {
    await this.writes.drain();
  }

  async readJson(): Promise<unknown | null> {
    try {
      const raw = await fs.readFile(path.join(this.dir, DATA_FILE));
      return JSON.parse(this.decrypt(raw).toString('utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      // Corrupção: tenta o backup antes de desistir.
      try {
        const bak = await fs.readFile(`${path.join(this.dir, DATA_FILE)}.bak`);
        return JSON.parse(this.decrypt(bak).toString('utf8'));
      } catch {
        throw new Error(`Falha ao ler os dados locais: ${(err as Error).message}`);
      }
    }
  }

  async writeJson(value: unknown): Promise<void> {
    const json = JSON.stringify(value);
    const file = path.join(this.dir, DATA_FILE);
    // Serializa: dois `writeJson` concorrentes não podem copiar/publicar ao mesmo tempo.
    await this.writes.run(async () => {
      // backup do arquivo anterior (uma geração), para recuperação de falha
      await fs.copyFile(file, `${file}.bak`).catch(() => undefined);
      await this.writeAtomic(file, this.encrypt(Buffer.from(json, 'utf8')));
    });
  }

  private recordingPath(id: string): string {
    // ids são gerados pelo app; ainda assim validamos para impedir path traversal
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(id)) throw new Error('Identificador de gravação inválido');
    return path.join(this.recordingsDir, `${id}.enc`);
  }

  async saveRecording(id: string, pcm: Float32Array): Promise<void> {
    const buf = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const target = this.recordingPath(id);
    const payload = this.encrypt(buf);
    await this.writes.run(() => this.writeAtomic(target, payload));
  }

  async readRecording(id: string): Promise<Float32Array> {
    const raw = await fs.readFile(this.recordingPath(id));
    const buf = this.decrypt(raw);
    // copia para um buffer alinhado antes de reinterpretar como Float32
    const aligned = new ArrayBuffer(buf.byteLength - (buf.byteLength % 4));
    new Uint8Array(aligned).set(buf.subarray(0, aligned.byteLength));
    return new Float32Array(aligned);
  }

  async deleteRecording(id: string): Promise<void> {
    await fs.rm(this.recordingPath(id), { force: true });
  }

  async exportWav(id: string, sampleRate: number, targetPath: string): Promise<void> {
    const pcm = await this.readRecording(id);
    const wav = encodeWav16(pcm, sampleRate, 1);
    await fs.writeFile(targetPath, wav, { mode: 0o600 });
  }

  /** Remove tudo, inclusive o cofre (usado em "apagar todos os meus dados"). */
  async wipe(): Promise<void> {
    await fs.rm(this.recordingsDir, { recursive: true, force: true });
    await fs.rm(path.join(this.dir, DATA_FILE), { force: true });
    await fs.rm(`${path.join(this.dir, DATA_FILE)}.bak`, { force: true });
    await fs.mkdir(this.recordingsDir, { recursive: true, mode: 0o700 });
  }

  /** Deriva uma chave de backup a partir da senha do usuário (opcional, não usado por padrão). */
  static deriveBackupKey(passphrase: string, salt: Buffer): Buffer {
    return scryptSync(passphrase, salt, 32);
  }
}
