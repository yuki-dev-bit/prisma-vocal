/**
 * Log local com rotação.
 *
 * Privacidade: nunca registramos áudio, nomes de arquivo pessoais, caminhos
 * completos do usuário nem conteúdo de anotações. Só evento + mensagem técnica
 * + versão. O arquivo fica no diretório de dados do app e pode ser apagado.
 */
import { app } from 'electron';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  type WriteStream,
} from 'node:fs';
import path from 'node:path';

const MAX_BYTES = 512 * 1024;
const MAX_FILES = 3;

let stream: WriteStream | null = null;
let logDir = '';

function ensureStream(): WriteStream | null {
  try {
    if (!logDir) {
      logDir = path.join(app.getPath('userData'), 'logs');
      mkdirSync(logDir, { recursive: true, mode: 0o700 });
    }
    if (stream) return stream;
    const file = path.join(logDir, 'prisma.log');
    if (existsSync(file) && statSync(file).size > MAX_BYTES) {
      for (let i = MAX_FILES - 1; i >= 1; i--) {
        const from = path.join(logDir, i === 1 ? 'prisma.log' : `prisma.${i - 1}.log`);
        const to = path.join(logDir, `prisma.${i}.log`);
        if (existsSync(from)) renameSync(from, to);
      }
    }
    stream = createWriteStream(path.join(logDir, 'prisma.log'), { flags: 'a', mode: 0o600 });
    stream.on('error', () => {
      stream = null;
    });
    return stream;
  } catch {
    return null;
  }
}

/** Remove caminhos absolutos e sequências longas que possam identificar o usuário. */
export function redact(input: string): string {
  return input
    .replace(/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)[^\s"'`]+/gi, '<caminho>')
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, '<email>')
    .slice(0, 2000);
}

type Level = 'info' | 'warn' | 'error';

/**
 * Metadados saneados.
 *
 * `redact` corta a string em 2000 caracteres; aplicado ao JSON de um objeto
 * grande isso gera JSON inválido e o `JSON.parse` lançava **dentro** do log —
 * ou seja, o tratamento de erro podia virar um novo erro, inclusive dentro de
 * `process.on('uncaughtException')`.
 */
function sanitizeMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!meta) return undefined;
  try {
    return JSON.parse(redact(JSON.stringify(meta))) as Record<string, unknown>;
  } catch {
    return { truncated: redact(String(JSON.stringify(meta) ?? '')).slice(0, 500) };
  }
}

export function log(level: Level, message: string, meta?: Record<string, unknown>): void {
  // Registrar nunca pode ser a causa de uma falha no aplicativo.
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      msg: redact(message),
      app: app.getVersion(),
      ...(meta ? { meta: sanitizeMeta(meta) } : {}),
    });
    if (level !== 'info') console[level === 'warn' ? 'warn' : 'error'](line);
    else console.log(line);
    const s = ensureStream();
    s?.write(`${line}\n`);
  } catch {
    /* última linha de defesa: nunca deixar o log derrubar o processo */
  }
}

export function closeLogger(): void {
  stream?.end();
  stream = null;
}
