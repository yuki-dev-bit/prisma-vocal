#!/usr/bin/env node
/**
 * Smoke de microfone e calibração (sem aparelho).
 *
 * Roda o app em Chromium com microfone sintético e verifica os fluxos que o
 * usuário reclamou:
 *
 *   1. captura inicia com permissão concedida (o caminho feliz);
 *   2. a calibração guiada mede o nível, salva o offset e mostra a confirmação;
 *   3. **o valor sobrevive a recarregar a página** (IndexedDB) e o convite de
 *      calibração desaparece depois de salvo;
 *   4. com a permissão negada, a mensagem é acionável e NÃO fica em silêncio.
 *
 * O que este teste NÃO cobre: o pedido de permissão nativo do Android/Electron
 * (depende de SO e de aparelho) e a existência do `MODIFY_AUDIO_SETTINGS` no
 * manifesto — isso é coberto por `tests/android-manifest.test.ts` e pela
 * revisão do Capacitor documentada no README.
 */
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { makeTestAudio } from './make-test-audio.mjs';

const require = createRequire(import.meta.url);
const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.env.PRISMA_PORT ?? 5301);
const FAKE_AUDIO = path.join(root, 'assets', 'dev', 'voz-sintetica.wav');
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const viteBin = require.resolve('vite/package.json').replace(/package\.json$/, 'bin/vite.js');
const server = spawn(
  process.execPath,
  [viteBin, 'preview', '--port', String(PORT), '--strictPort'],
  {
    cwd: root,
    stdio: 'ignore',
  },
);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* subindo */
    }
    await wait(200);
  }
  return false;
}

const log = (msg) => console.log(`[smoke-mic] ${msg}`);
const done = (code, msg) => {
  if (msg) (code === 0 ? log : (m) => console.error(`[smoke-mic] FALHOU: ${m}`))(msg);
  server.kill();
  process.exit(code);
};

// `assets/dev/*.wav` é gerado (e ignorado pelo git): quem clona o repositório não tem o
// arquivo. Sem ele o Chromium captura silêncio, o botão Salvar nunca habilita e o teste
// falharia com um timeout sem explicação — então geramos antes de abrir o navegador.
if (!existsSync(FAKE_AUDIO)) {
  makeTestAudio(FAKE_AUDIO);
  log(`áudio de teste gerado em ${path.relative(root, FAKE_AUDIO)}`);
}

const contextOptions = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  userAgent: ANDROID_UA,
  permissions: ['microphone'],
};

try {
  if (!(await waitForServer(`http://localhost:${PORT}/`))) {
    done(1, 'o preview não respondeu (rode `npm run build:renderer` antes).');
  }

  /* ------------------------- 1) permissão concedida ------------------------- */
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${FAKE_AUDIO}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.locator('.topbar-title', { hasText: 'Início' }).waitFor({ timeout: 20000 });

  // O convite de calibração aparece na tela inicial para quem nunca calibrou.
  await page.getByRole('button', { name: 'Calibrar agora' }).click();
  await page.getByRole('dialog', { name: 'Calibração do microfone' }).waitFor();
  log('diálogo de calibração aberto pelo convite da tela inicial');

  await page.getByRole('button', { name: 'Iniciar medição' }).click();
  const saveButton = page.getByRole('button', { name: 'Salvar calibração' });
  await saveButton.waitFor({ timeout: 15000 });
  // O botão Salvar só habilita quando há nível utilizável (mediana estável).
  await page.waitForFunction(
    () => {
      const btn = [...document.querySelectorAll('button')].find((b) =>
        (b.textContent ?? '').includes('Salvar calibração'),
      );
      return !!btn && !btn.disabled;
    },
    undefined,
    { timeout: 20000 },
  );
  const levelChip = page.getByRole('dialog').locator('.chip.mono').first();
  log(`nível medido: ${(await levelChip.textContent())?.trim()}`);

  await saveButton.click({ timeout: 15000 });
  await page.getByText('Calibração concluída e salva').waitFor({ timeout: 10000 });
  // Escopo no diálogo: a tela inicial (atrás do modal) também tem `.stat-value`.
  const offsetText = await page.getByRole('dialog').locator('.stat-value').first().textContent();
  const savedOffset = Number(
    String(offsetText)
      .replace(',', '.')
      .match(/-?\d+(\.\d+)?/)?.[0],
  );
  if (!Number.isFinite(savedOffset) || savedOffset <= 0) {
    done(1, `offset inválido exibido na confirmação: ${offsetText}`);
  }
  log(`calibração salva: offset de ${savedOffset} dB`);

  await page.getByRole('button', { name: 'Concluir' }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 });

  /* ------------- 2) persistência depois de recarregar a página ------------- */
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('.topbar-title', { hasText: 'Início' }).waitFor({ timeout: 20000 });
  const invite = await page.getByRole('button', { name: 'Calibrar agora' }).count();
  if (invite !== 0)
    done(1, 'o convite de calibração reapareceu depois de calibrar (valor não persistiu).');
  log('convite de calibração não reaparece após recarregar');

  await page.getByRole('button', { name: 'Configurações' }).first().click();
  await page.getByRole('tab', { name: 'Áudio' }).click();
  const status = page.getByText(/Calibrado com offset de/);
  await status.waitFor({ timeout: 10000 });
  const statusText = (await status.textContent()) ?? '';
  const persisted = Number(statusText.match(/offset de ([\d.,]+) dB/)?.[1].replace(',', '.'));
  if (Math.abs(persisted - savedOffset) > 0.05) {
    done(1, `offset persistido (${persisted}) difere do salvo (${savedOffset}).`);
  }
  log(`offset persistido após reload: ${persisted} dB — "${statusText.trim()}"`);

  // SPL passa a aparecer no medidor: prova que o analisador recebeu o offset.
  await page.getByRole('button', { name: 'Iniciar teste' }).click();
  await page
    .getByText(/≈ \d+ dB SPL/)
    .first()
    .waitFor({ timeout: 15000 });
  log('medidor ao vivo mostra estimativa em dB SPL depois da calibração');

  if (errors.length > 0) done(1, `erros de console: ${errors.slice(0, 3).join(' | ')}`);
  await context.close();
  await browser.close();

  /* ------------------------- 3) permissão negada ------------------------- */
  // Simula a recusa do sistema injetando exatamente o erro que o navegador
  // levanta (NotAllowedError). Não dá para "negar" no Chromium headless sem
  // diálogo de permissão — e o que interessa aqui é o caminho da interface.
  const denyBrowser = await chromium.launch();
  const denyContext = await denyBrowser.newContext({ ...contextOptions, permissions: [] });
  await denyContext.addInitScript(() => {
    const md = navigator.mediaDevices;
    if (md) {
      md.getUserMedia = () =>
        Promise.reject(new DOMException('Permission denied by system', 'NotAllowedError'));
    }
  });
  const denyPage = await denyContext.newPage();
  await denyPage.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await denyPage.getByRole('button', { name: 'Calibrar agora' }).click();
  await denyPage.getByRole('button', { name: 'Iniciar medição' }).click();

  const banner = denyPage.locator('.banner.danger').first();
  await banner.waitFor({ timeout: 15000 });
  const bannerText = (await banner.textContent()) ?? '';
  if (!/microfone/i.test(bannerText)) done(1, `mensagem de negação pouco clara: "${bannerText}"`);
  if (!/(Ajustes|permissõe|bloque)/i.test(bannerText)) {
    done(1, `a mensagem de negação não orienta o usuário: "${bannerText}"`);
  }
  log(`permissão negada tratada com orientação: "${bannerText.trim().slice(0, 120)}…"`);
  await denyBrowser.close();

  done(0, 'ok: captura, calibração, persistência após reload e negação de permissão.');
} catch (err) {
  done(1, err?.message ?? String(err));
}
