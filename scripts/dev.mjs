#!/usr/bin/env node
/**
 * Desenvolvimento: sobe o Vite, espera a porta e abre o Electron apontando
 * para o dev server (com HMR no renderer e rebuild automático do main).
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  checkDependencies,
  electronBinary,
  reportDependencies,
  resolveViteBin,
} from './check-deps.mjs';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const REQUESTED_PORT = Number(process.env.PRISMA_PORT ?? 5273);

/**
 * Porta livre para o Vite.
 *
 * Antes, se a 5273 estivesse ocupada (outro `npm run dev` esquecido, um preview,
 * um segundo terminal), o `--strictPort` fazia o Vite sair com código 1 e a única
 * mensagem era "o Vite encerrou com código 1 (porta 5273 ocupada?)" — sem dizer
 * o que fazer. Agora o script procura a próxima porta livre e informa a escolha.
 */
async function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.unref();
    server.listen(port, '0.0.0.0');
  });
}

async function findFreePort(start, attempts = 20) {
  for (let port = start; port < start + attempts; port++) {
    if (await isPortFree(port)) return port;
  }
  return null;
}

/* ------------------------------ pré-checagens ------------------------------ */

// `npm run dev -- --check` valida o caminho de inicialização sem abrir janela
// (usado pelo `npm run verify` e pelo CI para pegar referências quebradas).
// Nesse modo o binário do Electron não é exigido: ele não chega a ser iniciado.
const checkOnly = process.argv.includes('--check');

if (!checkDependencies({ electronOptional: checkOnly }).ok) {
  reportDependencies({ exitOnError: true, electronOptional: checkOnly });
  console.error('[dev] corrija as dependências acima e rode `npm run dev` novamente.\n');
  process.exit(1);
}

if (checkOnly) {
  reportDependencies({ electronOptional: true });
  console.log('[dev] pré-checagens ok (modo --check: nada foi iniciado).');
  process.exit(0);
}

/* ---------------------------------- porta ---------------------------------- */

const PORT = await findFreePort(REQUESTED_PORT);
if (!PORT) {
  console.error(
    `[dev] nenhuma porta livre entre ${REQUESTED_PORT} e ${REQUESTED_PORT + 19}.\n` +
      '      Feche outros `npm run dev`/previews abertos ou escolha outra faixa:\n' +
      '      PowerShell:  $env:PRISMA_PORT=5400 ; npm run dev',
  );
  process.exit(1);
}
if (PORT !== REQUESTED_PORT) {
  console.log(
    `[dev] porta ${REQUESTED_PORT} ocupada — usando ${PORT} (defina PRISMA_PORT para escolher outra).`,
  );
}

const env = {
  ...process.env,
  NODE_ENV: 'development',
  VITE_DEV_SERVER_URL: `http://localhost:${PORT}`,
};

/* ---------------------------------- build ---------------------------------- */

console.log('[dev] compilando processo principal…');
await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, [path.join(root, 'scripts/build-electron.mjs')], {
    stdio: 'inherit',
    env,
    cwd: root,
  });
  p.on('exit', (code) =>
    code === 0 ? resolve() : reject(new Error(`build-electron saiu com ${code}`)),
  );
});

/* ---------------------------------- vite ----------------------------------- */

const viteBin = resolveViteBin();
const vite = spawn(
  process.execPath,
  [viteBin, '--host', '0.0.0.0', '--port', String(PORT), '--strictPort'],
  {
    stdio: 'inherit',
    env,
    cwd: root,
  },
);

vite.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    console.error(`[dev] o Vite encerrou com código ${code} (porta ${PORT} ocupada?).`);
    process.exit(code);
  }
});

async function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

const ready = await waitForServer(`http://localhost:${PORT}/`);
if (!ready) {
  console.error('[dev] o servidor Vite não respondeu; encerrando.');
  vite.kill();
  process.exit(1);
}

/* -------------------------------- electron --------------------------------- */

const electronBin = electronBinary();
const electron = spawn(electronBin, [root], { stdio: 'inherit', env, cwd: root });

electron.on('exit', (code) => {
  vite.kill();
  process.exit(code ?? 0);
});

electron.on('error', (err) => {
  console.error('[dev] não foi possível iniciar o Electron:', err.message);
  vite.kill();
  process.exit(1);
});

process.on('SIGINT', () => {
  electron.kill();
  vite.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  electron.kill();
  vite.kill();
  process.exit(0);
});

// Um erro no próprio script não pode deixar o Vite rodando em segundo plano.
process.on('uncaughtException', (err) => {
  console.error('[dev] erro inesperado:', err?.message ?? err);
  electron.kill();
  vite.kill();
  process.exit(1);
});
