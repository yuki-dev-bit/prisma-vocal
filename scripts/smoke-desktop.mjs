#!/usr/bin/env node
/**
 * Smoke da versão desktop com o Electron de verdade (sem empacotar).
 *
 * Valida três coisas que só existem no processo principal:
 *
 *   1. o app sobe com o bundle de produção (`dist/`), monta a interface e abre
 *      com a geometria salva em disco;
 *   2. **fechar a janela grava o que estava pendente**: altera uma configuração
 *      e fecha em seguida (antes do debounce de 450 ms). Sem a descarga
 *      negociada no fechamento, esse valor se perdia;
 *   3. ao reabrir, o valor está lá — prova de que a persistência sobrevive ao
 *      ciclo fechar/abrir, não só a um reload da página.
 *
 * Usa um diretório de dados isolado (`XDG_CONFIG_HOME`/`APPDATA` temporários),
 * então não toca no cofre do usuário que roda o teste.
 *
 * Requer display: em Linux rode com `xvfb-run -a node scripts/smoke-desktop.mjs`.
 */
import { _electron as electron } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const electronBinary = require('electron');
const log = (m) => console.log(`[smoke-desktop] ${m}`);
const fail = (m) => {
  console.error(`[smoke-desktop] FALHOU: ${m}`);
  process.exit(1);
};

/** Build do processo principal (o renderer precisa existir em dist/). */
async function buildMain() {
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(root, 'scripts', 'build-electron.mjs')], {
      stdio: 'inherit',
      cwd: root,
      env: process.env,
    });
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`build-electron saiu com ${code}`)),
    );
  });
}

const isolatedEnv = (dir) => ({
  ...process.env,
  NODE_ENV: 'production',
  // Linux: userData = $XDG_CONFIG_HOME/<app>; Windows: %APPDATA%\<app>
  XDG_CONFIG_HOME: path.join(dir, 'config'),
  APPDATA: path.join(dir, 'appdata'),
  // Impede que um VITE_DEV_SERVER_URL herdado faça o app abrir o dev server.
  VITE_DEV_SERVER_URL: '',
});

async function launch(dir) {
  return electron.launch({
    executablePath: electronBinary,
    args: [root],
    env: isolatedEnv(dir),
  });
}

async function openAudioTab(win) {
  await win.locator('.nav-item').nth(7).click();
  await win.getByRole('tab', { name: 'Áudio' }).click();
  await win.waitForSelector('input[type="range"]');
}

/** Acha o `logs/prisma.log` dentro do diretório de dados isolado. */
async function findLog(dir) {
  for (const base of ['config', 'appdata']) {
    const root = path.join(dir, base);
    let entries = [];
    try {
      entries = await readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const file = path.join(root, entry, 'logs', 'prisma.log');
      try {
        await readFile(file, 'utf8');
        return file;
      } catch {
        /* tenta o próximo */
      }
    }
  }
  return null;
}

const gainValue = (win) =>
  win.evaluate(() => {
    // mostra o texto do slider de ganho (chip/valor ao lado do rótulo)
    const labels = [...document.querySelectorAll('.field, .slider')];
    const gain = labels.find((l) => /Ganho de entrada/i.test(l.textContent ?? ''));
    return gain?.textContent?.match(/-?\d+\s*dB/)?.[0]?.replace(/\s+/g, ' ') ?? null;
  });

let dir = '';
try {
  dir = await mkdtemp(path.join(tmpdir(), 'prisma-desktop-'));
  await buildMain();

  /* ---------------------------- primeira execução ---------------------------- */
  let app = await launch(dir);
  let win = await app.firstWindow();
  await win.waitForSelector('.nav-item', { timeout: 30000 });
  log('interface montada com o bundle de produção');

  await openAudioTab(win);
  const slider = win.locator('input[type="range"]').first();
  await slider.fill('6');
  const before = await gainValue(win);
  if (!/6/.test(before ?? ''))
    fail(`não foi possível alterar o ganho pela interface (lido: ${before})`);
  log(`ganho alterado para ${before} — fechando a janela imediatamente (antes do debounce)`);

  const closed = new Promise((resolve) => app.once('close', resolve));
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].close();
  });
  await Promise.race([closed, new Promise((r) => setTimeout(r, 15000))]);
  log('janela fechada pelo fluxo normal (descarga negociada)');

  /**
   * Prova de que a porta de fechamento rodou — e não apenas que o valor
   * "deu sorte" de ser gravado: o processo principal registra a espera no log
   * local. Sem a correção, essa linha não existe.
   */
  const logFile = await findLog(dir);
  if (!logFile) fail('o log local do aplicativo não foi criado');
  const logText = await readFile(logFile, 'utf8');
  if (!/aguardando descarga dos dados pendentes/.test(logText)) {
    fail('o fechamento não pediu a descarga dos dados ao renderer (porta de fechamento inativa)');
  }
  log('o processo principal aguardou a descarga antes de fechar');

  /* ----------------------------- segunda execução ---------------------------- */
  app = await launch(dir);
  win = await app.firstWindow();
  await win.waitForSelector('.nav-item', { timeout: 30000 });
  await openAudioTab(win);
  const after = await gainValue(win);
  if (after !== before) {
    fail(`o valor não sobreviveu ao fechamento: antes "${before}", depois "${after}"`);
  }
  log(`valor preservado após fechar e reabrir: ${after}`);

  // Geometria da janela salva em disco (window-state.json no userData).
  const bounds = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].getBounds(),
  );
  if (!(bounds.width >= 940 && bounds.height >= 640)) {
    fail(`geometria inesperada na reabertura: ${JSON.stringify(bounds)}`);
  }
  log(`janela reaberta em ${bounds.width}×${bounds.height} (mínimo respeitado)`);

  await app.close();
  await rm(dir, { recursive: true, force: true });
  log('ok: startup, fechamento com descarga e persistência entre execuções.');
  process.exit(0);
} catch (err) {
  if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  fail(err?.message ?? String(err));
}
