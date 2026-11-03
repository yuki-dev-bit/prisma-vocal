#!/usr/bin/env node
/**
 * Medidor de fluidez do HUD (sem aparelho).
 *
 * Roda o app em Chromium com microfone sintético, entra na tela de análise,
 * inicia a captura e mede por alguns segundos:
 *
 *   • intervalos entre quadros (rAF) — p50, p95, pior caso e % acima de 33 ms;
 *   • long tasks (>50 ms) no thread principal;
 *   • contagem de layouts e recálculos de estilo (CDP Performance);
 *   • nós do DOM na tela de análise.
 *
 * O Chromium roda com limitação de CPU (`Emulation.setCPUThrottlingRate`) para
 * aproximar um celular de faixa média. Não é um aparelho real — serve para
 * comparar **antes e depois** da mesma forma, que é o que interessa aqui.
 *
 * Uso:
 *   npm run build:renderer
 *   node scripts/perf-hud.mjs                      # throttle 4x (Android típico)
 *   node scripts/perf-hud.mjs --throttle 1         # sem limitação (PC)
 *   node scripts/perf-hud.mjs --seconds 10 --json  # saída para comparar
 *   node scripts/perf-hud.mjs --profile            # + top de funções por tempo próprio
 *   node scripts/perf-hud.mjs --dev --profile      # idem, no dev server (nomes legíveis)
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
const PORT = Number(process.env.PRISMA_PERF_PORT ?? 5311);
const FAKE_AUDIO = path.join(root, 'assets', 'dev', 'voz-sintetica.wav');
const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const THROTTLE = Number(flag('throttle', '4'));
const SECONDS = Number(flag('seconds', '8'));
const JSON_OUT = args.includes('--json');
const PROFILE = args.includes('--profile');
// No build de produção os nomes aparecem minificados (`Fr`, `br`…); no dev server
// os módulos são servidos sem minificar, o que torna o perfil legível.
const DEV = args.includes('--dev');

const log = (msg) => {
  if (!JSON_OUT) console.log(`[perf-hud] ${msg}`);
};

if (!DEV && !existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('[perf-hud] falta o build do renderer: rode `npm run build:renderer`.');
  process.exit(2);
}
if (!existsSync(FAKE_AUDIO)) makeTestAudio(FAKE_AUDIO);

const viteBin = require.resolve('vite/package.json').replace(/package\.json$/, 'bin/vite.js');
const server = spawn(
  process.execPath,
  [viteBin, DEV ? '' : 'preview', '--port', String(PORT), '--strictPort'].filter(Boolean),
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
const done = (code, payload) => {
  server.kill();
  if (payload) console.log(JSON.stringify(payload, null, 2));
  process.exit(code);
};

/**
 * Soma o tempo próprio (self time) de cada nó do perfil por nome de função.
 * `timeDeltas[i]` é o intervalo cobrado ao nó `samples[i]`.
 */
function topFunctions(profile, limit = 15) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  for (let i = 0; i < profile.samples.length; i++) {
    const node = byId.get(profile.samples[i]);
    if (!node) continue;
    const { functionName, url = '', lineNumber } = node.callFrame;
    const where = url ? `${url.replace(/^.*\/dist\//, '')}:${lineNumber + 1}` : '';
    const key = `${functionName || '(anônima)'} ${where}`.trim();
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0));
  }
  return [...self.entries()]
    .map(([name, us]) => ({ name, ms: Math.round(us / 1000) }))
    .sort((a, b) => b.ms - a.ms)
    .slice(0, limit);
}

try {
  if (!(await waitForServer(`http://localhost:${PORT}/`))) {
    done(2, { error: 'o preview não respondeu (rode `npm run build:renderer` antes)' });
  }

  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${FAKE_AUDIO}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: ANDROID_UA,
    permissions: ['microphone'],
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
  if (THROTTLE > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.locator('.topbar-title').first().waitFor({ timeout: 20000 });

  // Vai direto para a tela de análise (HUD completo: fita, espectrograma, formantes).
  await page
    .getByRole('button', { name: /Analisar/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Iniciar captura' }).click();
  await page.getByRole('button', { name: /Parar e analisar/ }).waitFor({ timeout: 20000 });
  await wait(1200); // deixa o buffer encher antes de medir

  if (PROFILE) await cdp.send('Profiler.enable');
  if (PROFILE) await cdp.send('Profiler.start');

  const before = await cdp.send('Performance.getMetrics');
  const metric = (m, name) => m.metrics.find((x) => x.name === name)?.value ?? 0;

  // Coleta de intervalos de quadro e long tasks dentro da página.
  await page.evaluate(() => {
    const w = window;
    w.__perf = { deltas: [], longTasks: [] };
    let last = performance.now();
    // Relógio monotônico dentro do callback: o timestamp do rAF pode chegar
    // levemente fora de ordem em relação a `performance.now()` e produzir
    // intervalos negativos que envenenam os percentis.
    const tick = () => {
      const now = performance.now();
      const d = now - last;
      if (d > 0) w.__perf.deltas.push(d);
      last = now;
      w.__perf.raf = requestAnimationFrame(tick);
    };
    w.__perf.raf = requestAnimationFrame(tick);
    try {
      const po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__perf.longTasks.push(e.duration);
      });
      po.observe({ type: 'longtask', buffered: true });
      w.__perf.po = po;
    } catch {
      /* longtask não suportado */
    }
  });

  await wait(SECONDS * 1000);

  const after = await cdp.send('Performance.getMetrics');
  const profile = PROFILE ? await cdp.send('Profiler.stop') : null;
  const sample = await page.evaluate(() => {
    const w = window;
    cancelAnimationFrame(w.__perf.raf);
    w.__perf.po?.disconnect();
    const deltas = w.__perf.deltas.slice(1);
    const sorted = [...deltas].sort((a, b) => a - b);
    const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
    return {
      frames: deltas.length,
      mean: +(deltas.reduce((a, b) => a + b, 0) / Math.max(1, deltas.length)).toFixed(2),
      p50: +pct(0.5).toFixed(2),
      p95: +pct(0.95).toFixed(2),
      max: +(sorted[sorted.length - 1] ?? 0).toFixed(2),
      over33: deltas.filter((d) => d > 33).length,
      over50: deltas.filter((d) => d > 50).length,
      longTasks: w.__perf.longTasks.length,
      longTaskMs: +w.__perf.longTasks.reduce((a, b) => a + b, 0).toFixed(1),
      domNodes: document.querySelectorAll('*').length,
      sampleRate: Number((document.body.innerText.match(/(\d{4,6}) Hz/) ?? [])[1]) || null,
      canvases: document.querySelectorAll('canvas').length,
    };
  });

  const result = {
    throttle: THROTTLE,
    seconds: SECONDS,
    frames: sample.frames,
    fps: +(sample.frames / SECONDS).toFixed(1),
    mean: sample.mean,
    p50: sample.p50,
    p95: sample.p95,
    max: sample.max,
    over33: sample.over33,
    over50: sample.over50,
    over33Pct: +((sample.over33 / Math.max(1, sample.frames)) * 100).toFixed(1),
    longTasks: sample.longTasks,
    longTaskMs: sample.longTaskMs,
    layouts: metric(after, 'LayoutCount') - metric(before, 'LayoutCount'),
    styleRecalcs: metric(after, 'RecalcStyleCount') - metric(before, 'RecalcStyleCount'),
    scriptsMs: +(
      (metric(after, 'ScriptDuration') - metric(before, 'ScriptDuration')) *
      1000
    ).toFixed(0),
    taskMs: +((metric(after, 'TaskDuration') - metric(before, 'TaskDuration')) * 1000).toFixed(0),
    domNodes: sample.domNodes,
    heapMB: +(metric(after, 'JSHeapUsedSize') / 1048576).toFixed(1),
    sampleRate: sample.sampleRate,
    canvases: sample.canvases,
    pageErrors: errors,
    top: profile ? topFunctions(profile.profile) : undefined,
  };

  await browser.close();

  if (JSON_OUT) {
    done(0, result);
  }
  log(`throttle ${THROTTLE}x · ${SECONDS}s · ${result.frames} quadros (${result.fps} fps)`);
  log(
    `quadro: média ${result.mean} ms · p50 ${result.p50} ms · p95 ${result.p95} ms · ` +
      `pior ${result.max} ms · ${result.over33Pct}% acima de 33 ms`,
  );
  log(
    `long tasks: ${result.longTasks} (${result.longTaskMs} ms) · layouts ${result.layouts} · ` +
      `recálculos de estilo ${result.styleRecalcs}`,
  );
  log(
    `CPU: script ${result.scriptsMs} ms de ${result.taskMs} ms de tarefa · ` +
      `${result.domNodes} nós · ${result.canvases} canvases · taxa de captura ${result.sampleRate ?? '?'} Hz · ` +
      `heap ${result.heapMB} MB`,
  );
  if (result.top) {
    log('tempo próprio por função (CPU do thread principal):');
    for (const row of result.top) log(`  ${row.ms.toString().padStart(6)} ms  ${row.name}`);
  }
  if (result.pageErrors.length) log(`ERROS DE PÁGINA: ${result.pageErrors.join(' | ')}`);
  done(result.pageErrors.length ? 1 : 0);
} catch (err) {
  done(1, { error: String(err?.message ?? err) });
}
