#!/usr/bin/env node
/**
 * Diagnóstico de dependências.
 *
 * Existe porque versões recentes do npm bloqueiam scripts de instalação de
 * dependências por padrão ("install-scripts"): o pacote `electron` é instalado,
 * mas o binário nunca é baixado — e o sintoma é um erro obscuro ao iniciar.
 *
 * Roda automaticamente no `postinstall` (apenas avisa) e é usado pelo
 * `scripts/dev.mjs` como pré-checagem (impede iniciar sem o binário).
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const MIN_NODE = [22, 12, 0];

function nodeOk() {
  const [major, minor, patch] = (process.versions.node ?? '0.0.0').split('.').map(Number);
  const [rMajor, rMinor, rPatch] = MIN_NODE;
  if (major !== rMajor) return major > rMajor;
  if (minor !== rMinor) return minor > rMinor;
  return patch >= rPatch;
}

/** Caminho do CLI do Vite, sem depender de subpath interno do `exports`. */
export function resolveViteBin() {
  let pkgPath;
  try {
    pkgPath = require.resolve('vite/package.json');
  } catch {
    pkgPath = path.join(root, 'node_modules', 'vite', 'package.json');
  }
  if (!existsSync(pkgPath)) return null;
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const rel = typeof pkg.bin === 'string' ? pkg.bin : (pkg.bin?.vite ?? 'bin/vite.js');
  const bin = path.join(path.dirname(pkgPath), rel);
  return existsSync(bin) ? bin : null;
}

/**
 * Executável do Electron.
 *
 * Lido do `path.txt` do pacote — e **não** com `require('electron')`, porque o
 * index.js desse pacote baixa ~120 MB quando o binário falta. Isso quebrava o
 * job de typecheck no CI (que roda com ELECTRON_SKIP_BINARY_DOWNLOAD=1) e
 * tornava `npm run doctor` lento e dependente de rede.
 */
export function electronBinary() {
  let pkgDir = path.join(root, 'node_modules', 'electron');
  try {
    pkgDir = path.dirname(require.resolve('electron/package.json'));
  } catch {
    /* mantém o caminho padrão */
  }
  const pathFile = path.join(pkgDir, 'path.txt');
  if (!existsSync(pathFile)) return null;
  const rel = readFileSync(pathFile, 'utf8').trim();
  if (!rel) return null;
  const normalized = rel.split('/').join(path.sep);
  // O `path.txt` é relativo de formas diferentes por plataforma:
  //   Linux/macOS → "electron"        (dentro de dist/)
  //   Windows     → "dist/electron.exe"
  // Testar as duas montagens evita falso negativo sem tocar em `require('electron')`.
  const candidates = [path.join(pkgDir, normalized), path.join(pkgDir, 'dist', normalized)];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * @param {{ electronOptional?: boolean }} [options]
 *   `electronOptional`: o binário não é necessário (typecheck, testes, CI,
 *   `npm run dev -- --check`). Ele aparece no relatório, mas não reprova.
 */
export function checkDependencies({ electronOptional = false } = {}) {
  const missing = [];
  if (!resolveViteBin()) missing.push('vite');
  const electron = electronBinary();
  const electronMissing = !electron && !electronOptional;
  if (electronMissing) missing.push('electron');
  return {
    ok: missing.length === 0,
    missing,
    electron,
    electronMissing: !electron,
    nodeOk: nodeOk(),
  };
}

const FIX_HINT = `
Como corrigir os scripts de instalação bloqueados:

  npm install-scripts approve electron esbuild     # npm recente (recurso allowScripts)
  npm rebuild electron                             # baixa o binário do Electron
  npm install --ignore-scripts=false               # alternativa em versões antigas
`;

export function reportDependencies({ exitOnError = false, electronOptional = false } = {}) {
  const {
    ok,
    missing,
    nodeOk: versionOk,
    electronMissing,
  } = checkDependencies({ electronOptional });
  if (!versionOk) {
    console.warn(
      `[deps] Node ${process.versions.node} é mais antigo que o mínimo (22.12). ` +
        'Instale Node 22 LTS ou superior: https://nodejs.org',
    );
  }
  if (electronMissing && electronOptional) {
    console.warn('[deps] binário do Electron ausente — ok neste modo (ele não é iniciado).');
  }
  if (ok) return true;
  console.warn(`[deps] dependências incompletas: ${missing.join(', ')}`);
  if (missing.includes('electron')) console.warn(FIX_HINT);
  if (exitOnError) process.exitCode = 1;
  return false;
}

if (process.argv[1] && /check-deps\.mjs$/.test(process.argv[1])) {
  const strict = process.argv.includes('--strict');
  const ok = reportDependencies({ exitOnError: strict });
  if (ok) console.log('[deps] tudo certo: Node, Vite e Electron prontos.');
  if (!ok && !strict) {
    console.log('[deps] o app ainda não pode iniciar; siga as instruções acima e rode de novo.');
  }
}
