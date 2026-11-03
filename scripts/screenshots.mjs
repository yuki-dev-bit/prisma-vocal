#!/usr/bin/env node
/**
 * Gera as capturas de tela do README usando Chromium headless com um
 * microfone simulado (`--use-file-for-fake-audio-capture`).
 *
 * Isso NÃO substitui teste em hardware real: serve para validar que a
 * interface renderiza e que o pipeline de análise reage a áudio de entrada.
 *
 * Uso:
 *   npm run dev:web            (em outro terminal)
 *   node scripts/screenshots.mjs [url]
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { makeTestAudio } from './make-test-audio.mjs';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const url = process.argv[2] ?? process.env.PRISMA_URL ?? 'http://localhost:5273/';
const outDir = path.join(root, 'docs', 'screenshots');
const audioFile = path.join(root, 'assets', 'dev', 'voz-sintetica.wav');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await mkdir(outDir, { recursive: true });
  if (!existsSync(audioFile)) {
    makeTestAudio(audioFile);
    console.log(`[screenshots] áudio de teste gerado em ${path.relative(root, audioFile)}`);
  }
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${audioFile}`,
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1460, height: 940 },
    deviceScaleFactor: 2,
    locale: 'pt-BR',
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('.app-shell', { timeout: 15000 });

  const shot = async (name, resetScroll = true) => {
    if (resetScroll) {
      await page.evaluate(() => {
        const el = document.querySelector('.content');
        if (el) el.scrollTop = 0;
        window.scrollTo(0, 0);
      });
    }
    await wait(450);
    await page.screenshot({ path: path.join(outDir, `${name}.png`) });
    console.log(`[screenshots] ${name}.png`);
  };

  const nav = async (label) => {
    await page.getByRole('button', { name: label, exact: true }).first().click();
    await wait(320);
  };

  // 1. Início (estado inicial)
  await shot('01-inicio');

  // 2. Analisar com captura ao vivo (microfone simulado)
  await nav('Analisar');
  await page.getByRole('button', { name: 'Iniciar captura' }).click();
  await wait(5200);
  await shot('02-analisar-ao-vivo');
  await page.getByRole('button', { name: 'Parar e analisar' }).click();
  await wait(900);
  await shot('03-analise-resultado', false);

  // 2b. Segunda tomada — permite a comparação A/B em Gravações
  await page.getByRole('button', { name: 'Iniciar captura' }).click();
  await wait(4200);
  await page.getByRole('button', { name: 'Parar e analisar' }).click();
  await wait(900);

  // 3. Treino
  await nav('Treinar');
  await shot('04-treino-aula');
  const practice = page.getByRole('button', { name: /Praticar agora/ }).first();
  if (await practice.count()) {
    await practice.click();
    await wait(4200);
    await shot('05-treino-exercicio-ao-vivo');
    const stop = page.getByRole('button', { name: /Parar/ }).first();
    if (await stop.count()) await stop.click();
    await wait(1400);
    await shot('06-treino-feedback', false);
  }

  // 4. Avaliação — percorre as etapas com capturas curtas
  await nav('Avaliação');
  await shot('07-avaliacao-inicio');
  for (let i = 0; i < 7; i += 1) {
    const rec = page.getByRole('button', { name: /Gravar etapa/ });
    if (!(await rec.count())) break;
    await rec.click();
    await wait(2600);
    const done = page.getByRole('button', { name: /Concluir etapa/ });
    if (await done.count()) await done.click();
    await wait(700);
  }
  const finish = page.getByRole('button', { name: 'Ver resultado' });
  if (await finish.count()) await finish.click();
  await wait(900);
  await shot('08-avaliacao-resultado');

  // 5. Progresso
  await nav('Progresso');
  await shot('09-progresso');

  // 6. Gravações (comparação)
  await nav('Gravações');
  const selects = page.locator('select');
  if ((await selects.count()) >= 2) {
    const options = await selects.nth(0).locator('option').count();
    if (options > 1) {
      await selects.nth(0).selectOption({ index: 1 });
      await selects.nth(1).selectOption({ index: options - 1 });
      await wait(600);
    }
  }
  await shot('10-gravacoes-comparacao');

  // 7. Diário
  await nav('Diário');
  await page
    .locator('textarea')
    .first()
    .fill(
      'Hoje a voz estava mais estável no grave e consegui manter o brilho por mais tempo. Ambiente silencioso, sem fones.',
    );
  await page.getByRole('button', { name: 'Salvar', exact: true }).first().click();
  await wait(700);
  await shot('11-diario');

  // 8. Configurações
  await nav('Configurações');
  await shot('12-configuracoes-audio');
  await page.getByRole('tab', { name: 'Acessibilidade' }).click();
  await wait(400);
  await shot('13-acessibilidade');

  // 9. Início depois de ter histórico
  await nav('Início');
  await shot('14-inicio-com-historico');

  await browser.close();

  if (errors.length) {
    console.warn(`[screenshots] ${errors.length} erro(s) de console:`);
    for (const e of errors.slice(0, 12)) console.warn('  -', e);
    process.exitCode = 0;
  } else {
    console.log('[screenshots] nenhum erro de console.');
  }
}

main().catch((err) => {
  console.error('[screenshots] falhou:', err);
  process.exit(1);
});
