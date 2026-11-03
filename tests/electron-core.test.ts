/**
 * Núcleo do processo principal (Electron) — regras puras, testadas sem abrir janela.
 *
 * Cada bloco corresponde a um defeito encontrado na auditoria da versão desktop:
 *  • geometria da janela (abria maior que a tela / fora da tela, sem memória);
 *  • fila de escrita (temporário compartilhado ⇒ arquivo truncado em gravações
 *    simultâneas);
 *  • lembretes (intervalo de 30 s com comparação de igualdade perdia o horário);
 *  • porta de fechamento (descarga do renderer não terminava antes do destroy).
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_WINDOW,
  effectiveMinSize,
  fitToWorkArea,
  parseWindowState,
  type Rect,
} from '../electron/window-state';
import { WriteQueue } from '../electron/storage/write-queue';
import { parseReminderTime, shouldFireReminder } from '../electron/reminder-schedule';
import { createCloseGate } from '../electron/close-flush';

const workArea: Rect = { x: 0, y: 0, width: 1366, height: 728 };
const state = (bounds: Partial<Rect>, maximized = false) => ({
  bounds: { x: 0, y: 0, width: 1280, height: 860, ...bounds },
  maximized,
});

describe('window-state', () => {
  it('abre no tamanho padrão, centralizado e dentro da área útil', () => {
    const fit = fitToWorkArea(null, workArea);
    expect(fit.bounds.width).toBe(1280);
    // 860 de altura não cabe em 728: encolhe em vez de abrir cortado
    expect(fit.bounds.height).toBe(728);
    expect(fit.bounds.x).toBe(Math.round((1366 - 1280) / 2));
    expect(fit.maximized).toBe(false);
  });

  it('respeita a posição salva quando ela está visível', () => {
    const fit = fitToWorkArea(state({ x: 100, y: 60, width: 1000, height: 700 }), workArea);
    expect(fit.bounds).toEqual({ x: 100, y: 60, width: 1000, height: 700 });
  });

  it('recentraliza quando a janela foi salva fora da tela (monitor desconectado)', () => {
    const fit = fitToWorkArea(state({ x: 5000, y: -3000, width: 1000, height: 700 }), workArea);
    expect(fit.bounds.x).toBe(Math.round((1366 - 1000) / 2));
    expect(fit.bounds.y).toBe(Math.round((728 - 700) / 2));
  });

  it('mantém a janela em monitor à esquerda (coordenadas negativas)', () => {
    const leftMonitor: Rect = { x: -1920, y: 0, width: 1920, height: 1080 };
    const fit = fitToWorkArea(state({ x: -1800, y: 100, width: 1200, height: 800 }), leftMonitor);
    expect(fit.bounds.x).toBe(-1800);
    expect(fit.bounds.y).toBe(100);
  });

  it('salvaguarda a barra de título: janela salva acima da área útil é recentralizada', () => {
    const fit = fitToWorkArea(state({ x: 100, y: -600, width: 1000, height: 700 }), workArea);
    expect(fit.bounds.y).toBeGreaterThanOrEqual(0);
  });

  it('não diminui abaixo do mínimo, exceto se a tela for menor que ele', () => {
    const tiny: Rect = { x: 0, y: 0, width: 700, height: 500 };
    const fit = fitToWorkArea(state({ x: 10, y: 10, width: 400, height: 300 }), tiny);
    expect(fit.bounds.width).toBe(700);
    expect(fit.bounds.height).toBe(500);
    expect(effectiveMinSize(tiny)).toEqual({ width: 700, height: 500 });
    // em tela grande o mínimo continua sendo 940×640
    expect(effectiveMinSize(workArea)).toEqual({ width: 940, height: 640 });
  });

  it('preserva o estado maximizado', () => {
    expect(fitToWorkArea(state({ x: 0, y: 0 }, true), workArea).maximized).toBe(true);
  });

  it('descarta estados inválidos em vez de abrir a janela em 0×0', () => {
    expect(parseWindowState(null)).toBeNull();
    expect(parseWindowState({ bounds: {} })).toBeNull();
    expect(parseWindowState({ bounds: { x: 0, y: 0, width: 50, height: 50 } })).toBeNull();
    expect(parseWindowState({ bounds: { x: 'a', y: 0, width: 800, height: 600 } })).toBeNull();
    expect(
      parseWindowState({ bounds: { x: 5, y: 5, width: 800, height: 600 }, maximized: 'sim' }),
    ).toEqual({
      bounds: { x: 5, y: 5, width: 800, height: 600 },
      maximized: false,
    });
  });

  it('o tamanho padrão cabe em telas comuns', () => {
    expect(DEFAULT_WINDOW.width).toBeLessThanOrEqual(1366);
  });
});

describe('WriteQueue', () => {
  afterEach(() => vi.restoreAllMocks());

  it('executa na ordem de chegada, mesmo com tarefas de durações diferentes', async () => {
    const order: number[] = [];
    const queue = new WriteQueue();
    const tasks = [30, 5, 15, 0].map((delay, index) =>
      queue.run(async () => {
        await new Promise((r) => setTimeout(r, delay));
        order.push(index);
        return index;
      }),
    );
    expect(await Promise.all(tasks)).toEqual([0, 1, 2, 3]);
    expect(order).toEqual([0, 1, 2, 3]);
  });

  it('um erro não trava as próximas tarefas e é propagado a quem chamou', async () => {
    const queue = new WriteQueue();
    const failing = queue.run(async () => {
      throw new Error('falhou');
    });
    const next = queue.run(async () => 'ok');
    await expect(failing).rejects.toThrow('falhou');
    await expect(next).resolves.toBe('ok');
    await expect(queue.drain()).resolves.toBeUndefined();
  });

  it('gera sufixos de temporário únicos (o bug do arquivo compartilhado)', () => {
    const queue = new WriteQueue();
    const suffixes = new Set(Array.from({ length: 50 }, () => queue.nextTempSuffix()));
    expect(suffixes.size).toBe(50);
    expect(queue.pendingSequence).toBe(50);
  });

  it('não intercala escritas concorrentes no mesmo arquivo', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'prisma-queue-'));
    const file = path.join(dir, 'app-data.enc');
    const queue = new WriteQueue();
    const payloads = Array.from({ length: 12 }, (_, i) =>
      JSON.stringify({ i, filler: 'x'.repeat(2000) }),
    );

    await Promise.all(
      payloads.map((payload) =>
        queue.run(async () => {
          const tmp = `${file}.tmp-${queue.nextTempSuffix()}`;
          await writeFile(tmp, payload);
          const { rename } = await import('node:fs/promises');
          await rename(tmp, file);
        }),
      ),
    );

    const written = await readFile(file, 'utf8');
    // o conteúdo final é exatamente UM dos payloads — nunca um híbrido truncado
    expect(payloads).toContain(written);
    expect(() => JSON.parse(written)).not.toThrow();
    await rm(dir, { recursive: true, force: true });
  });
});

describe('reminder-schedule', () => {
  const at = (iso: string) => new Date(iso);

  it('dispara no horário exato', () => {
    const d = shouldFireReminder(
      { enabled: true, time: '19:00', weekdays: [] },
      at('2026-10-31T19:00:10'),
      '',
    );
    expect(d.fire).toBe(true);
    expect(d.key).toBe('2026-10-31 19:00');
    expect(d.lateMinutes).toBe(0);
  });

  it('dispara dentro da tolerância (computador voltou da suspensão 12 min depois)', () => {
    const d = shouldFireReminder(
      { enabled: true, time: '19:00', weekdays: [] },
      at('2026-10-31T19:12:00'),
      '',
    );
    expect(d.fire).toBe(true);
    expect(d.lateMinutes).toBe(12);
  });

  it('não dispara antes da hora, nem depois da tolerância', () => {
    expect(
      shouldFireReminder(
        { enabled: true, time: '19:00', weekdays: [] },
        at('2026-10-31T18:59:59'),
        '',
      ).fire,
    ).toBe(false);
    expect(
      shouldFireReminder(
        { enabled: true, time: '19:00', weekdays: [] },
        at('2026-10-31T19:31:00'),
        '',
      ).fire,
    ).toBe(false);
  });

  it('não repete o mesmo dia/horário', () => {
    const first = shouldFireReminder(
      { enabled: true, time: '19:00', weekdays: [] },
      at('2026-10-31T19:05:00'),
      '',
    );
    const again = shouldFireReminder(
      { enabled: true, time: '19:00', weekdays: [] },
      at('2026-10-31T19:20:00'),
      first.key,
    );
    expect(again.fire).toBe(false);
  });

  it('respeita os dias da semana e trata lista vazia como todos os dias', () => {
    // 2026-10-31 é sábado (6)
    expect(
      shouldFireReminder(
        { enabled: true, time: '09:00', weekdays: [1, 3, 5] },
        at('2026-10-31T09:00:00'),
        '',
      ).fire,
    ).toBe(false);
    expect(
      shouldFireReminder(
        { enabled: true, time: '09:00', weekdays: [6] },
        at('2026-10-31T09:00:00'),
        '',
      ).fire,
    ).toBe(true);
    expect(
      shouldFireReminder(
        { enabled: true, time: '09:00', weekdays: [] },
        at('2026-10-31T09:00:00'),
        '',
      ).fire,
    ).toBe(true);
  });

  it('fica inerte quando desligado ou com horário inválido', () => {
    expect(
      shouldFireReminder(
        { enabled: false, time: '19:00', weekdays: [] },
        at('2026-10-31T19:00:00'),
        '',
      ).fire,
    ).toBe(false);
    expect(
      shouldFireReminder(
        { enabled: true, time: '25:99', weekdays: [] },
        at('2026-10-31T19:00:00'),
        '',
      ).fire,
    ).toBe(false);
    expect(parseReminderTime('19:00')).toEqual({ hour: 19, minute: 0 });
    expect(parseReminderTime('7:00')).toBeNull();
  });
});

describe('close-flush', () => {
  afterEach(() => vi.useRealTimers());

  it('segura o primeiro fechamento até a interface confirmar', async () => {
    const gate = createCloseGate(1500);
    const wait = gate.request();
    expect(wait).not.toBeNull();
    let settled = false;
    void wait!.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    gate.ack();
    await wait;
    expect(settled).toBe(true);
  });

  it('não reinicia o fluxo se o usuário clicar em fechar de novo', () => {
    const gate = createCloseGate(1500);
    expect(gate.request()).not.toBeNull();
    expect(gate.request()).toBeNull();
    expect(gate.isArmed).toBe(true);
  });

  it('libera o fechamento por prazo quando a interface não responde', async () => {
    vi.useFakeTimers();
    const gate = createCloseGate(1000);
    const wait = gate.request()!;
    let settled = false;
    void wait.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(1001);
    expect(settled).toBe(true);
  });
});
