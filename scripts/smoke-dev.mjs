#!/usr/bin/env node
/**
 * Smoke do modo de desenvolvimento.
 *
 * Verifica o que quebrou em campo: o Vite injeta o preâmbulo do React Refresh
 * como script inline e abre um WebSocket para o HMR. Se a CSP de produção
 * vazar para o dev server, a janela do Electron abre em branco
 * ("@vitejs/plugin-react can't detect preamble"). Este script sobe o Vite de
 * verdade, baixa o index.html servido e confere a política de dev nas duas
 * pontas (HTML e processo principal compilado).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const fail = (msg) => {
  console.error(`[smoke-dev] FALHOU: ${msg}`);
  process.exit(1);
};

const server = await createServer({
  root,
  configFile: path.join(root, 'vite.config.ts'),
  logLevel: 'silent',
  // porta efêmera: o smoke não pode colidir com um `npm run dev` aberto
  server: { port: 0, strictPort: false, host: '127.0.0.1' },
});
try {
  await server.listen();
  const url = server.resolvedUrls?.local?.[0];
  if (!url) fail('o Vite não expôs uma URL local');

  const html = await (await fetch(url)).text();

  if (!html.includes("script-src 'self' 'unsafe-inline'")) {
    fail(
      `CSP sem 'unsafe-inline' no dev server: o preâmbulo do React Refresh seria bloqueado (${url})`,
    );
  }
  if (!html.includes('connect-src') || !/connect-src[^;"]*ws:/.test(html)) {
    fail('CSP de dev sem ws: — o HMR não conectaria');
  }
  if (!html.includes('/src/renderer/main.tsx'))
    fail('o HTML servido não carrega o entrypoint do renderer');

  // Fonte do processo principal: é o que garante a política no Electron.
  const mainSource = readFileSync(path.join(root, 'electron', 'main.ts'), 'utf8');
  if (!mainSource.includes('CSP_DEV')) {
    fail('electron/main.ts não define CSP_DEV: o dev server receberia a CSP de produção');
  }
  if (!/script-src 'self' 'unsafe-inline' 'unsafe-eval'/.test(mainSource)) {
    fail(
      "CSP_DEV sem 'unsafe-inline'/'unsafe-eval' em script-src: o preâmbulo do React Refresh seria bloqueado",
    );
  }
  if (!/connect-src[^\]]*ws:/.test(mainSource)) {
    fail('CSP_DEV sem ws: em connect-src: o HMR não conectaria');
  }
  if (!/isDev \? CSP_DEV : CSP/.test(mainSource)) {
    fail('a escolha entre CSP_DEV e CSP não está condicionada a isDev');
  }

  // Bundle compilado: só é conferido quando existe (o typecheck do CI não compila).
  const bundlePath = path.join(root, 'dist-electron', 'main.cjs');
  if (existsSync(bundlePath)) {
    const mainBundle = readFileSync(bundlePath, 'utf8');
    if (!mainBundle.includes('unsafe-eval')) {
      fail('dist-electron/main.cjs está desatualizado: rode `npm run build:electron`');
    }
    console.log('[smoke-dev] bundle do processo principal confere com a fonte.');
  } else {
    console.log(
      '[smoke-dev] dist-electron/main.cjs ausente — verificação do bundle ignorada (fonte ok).',
    );
  }

  console.log(
    `[smoke-dev] ok: Vite em ${url} serve CSP de dev válida e o Electron usa a mesma política.`,
  );
} finally {
  await server.close();
}
