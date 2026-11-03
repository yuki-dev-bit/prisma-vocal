import { describe, expect, it } from 'vitest';
import { buildHtmlReport, buildMarkdownReport } from '@core/reports/report';
import { createInitialData } from '@core/storage/repository';
import type { AppData, Goal, JournalEntry, SessionRecord } from '@shared/types';
import { makeMetrics, makeProfile } from './helpers/metrics';

const session = (patch: Partial<SessionRecord> = {}): SessionRecord => ({
  id: `s-${patch.createdAt ?? 'a'}`,
  createdAt: '2026-03-01T10:00:00.000Z',
  mode: 'mtf',
  kind: 'sustentado',
  durationSec: 60,
  metrics: makeMetrics(),
  score: 80,
  recordingId: null,
  feedback: [],
  ...patch,
});

const todasAsOpcoes = { includeJournal: true, includeSessions: 10, includeGoals: true };

const comPerfil = (): AppData => ({
  ...createInitialData(),
  profile: makeProfile({ strengths: ['Boa estabilidade'], challenges: ['Soprosidade alta'] }),
});

describe('buildMarkdownReport', () => {
  it('traz o aviso de que não é diagnóstico, sempre', () => {
    const md = buildMarkdownReport(createInitialData(), todasAsOpcoes);
    expect(md).toContain('# Relatório de evolução vocal');
    expect(md).toMatch(/Não é um diagnóstico clínico/);
    expect(md).toMatch(/procure avaliação profissional/);
  });

  it('sem perfil, explica que a avaliação inicial não foi feita', () => {
    const md = buildMarkdownReport(createInitialData(), todasAsOpcoes);
    expect(md).toMatch(/Avaliação inicial ainda não concluída/);
    expect(md).not.toContain('Piso estimado');
  });

  it('com perfil, descreve faixa, piso, teto, centro e extensão', () => {
    const md = buildMarkdownReport(comPerfil(), todasAsOpcoes);
    expect(md).toContain('Classificação descritiva');
    expect(md).toContain('Piso estimado: 82 Hz');
    expect(md).toContain('Teto estimado: 330 Hz');
    expect(md).toContain('Centro confortável: 130 Hz');
    expect(md).toContain('Extensão medida: 24.0 semitons');
    expect(md).toContain('Boa estabilidade');
    expect(md).toContain('Soprosidade alta');
  });

  it('lista no máximo a quantidade pedida de sessões, das mais recentes', () => {
    const data: AppData = {
      ...createInitialData(),
      sessions: [
        session({ id: 'a', createdAt: '2026-03-01T10:00:00.000Z', score: 50 }),
        session({ id: 'b', createdAt: '2026-03-02T10:00:00.000Z', score: 70 }),
        session({ id: 'c', createdAt: '2026-03-03T10:00:00.000Z', score: null }),
      ],
    };
    const md = buildMarkdownReport(data, { ...todasAsOpcoes, includeSessions: 2 });
    expect(md).toContain('## Sessões recentes');
    expect(md).toContain('03/03/2026');
    expect(md).toContain('—'); // nota nula vira travessão
    expect(md).not.toContain('01/03/2026');
  });

  it('com menos de duas sessões avisa que ainda não há evolução', () => {
    const md = buildMarkdownReport(
      { ...createInitialData(), sessions: [session()] },
      todasAsOpcoes,
    );
    expect(md).toContain('Ainda não há sessões suficientes para calcular evolução.');
  });

  it('com duas sessões mostra a variação, inclusive em semitons para f0', () => {
    const md = buildMarkdownReport(
      {
        ...createInitialData(),
        sessions: [
          session({
            createdAt: '2026-02-01T10:00:00.000Z',
            metrics: makeMetrics({ f0MedianHz: 120 }),
          }),
          session({
            createdAt: '2026-03-01T10:00:00.000Z',
            metrics: makeMetrics({ f0MedianHz: 135 }),
          }),
        ],
      },
      todasAsOpcoes,
    );
    expect(md).toContain('### Evolução (primeira × última sessão)');
    expect(md).toMatch(/\| altura mediana \| 120\.0 \| 135\.0 \| \+[\d.]+ st \|/);
  });

  it('mostra progresso por módulo e só inclui metas/diário quando pedido', () => {
    const goal: Goal = {
      id: 'g1',
      title: 'Subir o centro',
      createdAt: '2026-03-01T10:00:00.000Z',
      targetDate: null,
      metric: 'f0MedianHz',
      target: 140,
      relativeTo: 'baseline',
      baselineValue: 130,
      status: 'ativa',
      note: '',
    };
    const entrada: JournalEntry = {
      id: 'j1',
      date: '2026-03-02',
      mood: 4,
      energy: 3,
      notes: 'voz mais solta',
      tags: [],
    };
    const data: AppData = { ...createInitialData(), goals: [goal], journal: [entrada] };

    const completo = buildMarkdownReport(data, todasAsOpcoes);
    expect(completo).toContain('## Progresso no treino');
    expect(completo).toContain('## Metas');
    expect(completo).toContain('Subir o centro');
    expect(completo).toContain('voz mais solta');

    const enxuto = buildMarkdownReport(data, {
      includeJournal: false,
      includeSessions: 5,
      includeGoals: false,
    });
    expect(enxuto).not.toContain('## Metas');
    expect(enxuto).not.toContain('## Diário vocal');
  });

  it('não vaza dado de áudio nem caminho de arquivo no relatório', () => {
    const md = buildMarkdownReport(comPerfil(), todasAsOpcoes);
    expect(md).not.toMatch(/\/home\/|C:\\\\/);
    expect(md).not.toMatch(/data:audio/);
  });
});

describe('buildHtmlReport', () => {
  it('é um HTML autocontido, sem script nem recurso externo', () => {
    const html = buildHtmlReport(comPerfil(), todasAsOpcoes);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\/[^"]*\.(js|css)/i);
    expect(html).not.toMatch(/<link\s/i);
    expect(html).not.toMatch(/<img/i);
  });

  it('escapa HTML vindo do conteúdo do usuário', () => {
    const data: AppData = {
      ...createInitialData(),
      journal: [
        {
          id: 'j1',
          date: '2026-03-02',
          mood: 3,
          energy: 3,
          notes: '<script>alert(1)</script> & <b>oi</b>',
          tags: [],
        },
      ],
    };
    const html = buildHtmlReport(data, todasAsOpcoes);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&amp;');
  });

  it('converte títulos, listas, citações e tabelas', () => {
    const html = buildHtmlReport(
      {
        ...createInitialData(),
        profile: makeProfile(),
        sessions: [session(), session({ createdAt: '2026-03-05T10:00:00.000Z' })],
      },
      todasAsOpcoes,
    );
    expect(html).toContain('<h1>');
    expect(html).toContain('<h2>');
    expect(html).toContain('<h3>');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('<ul><li>');
    expect(html).toContain('<table><tr>');
    expect(html).toContain('</html>');
  });
});

describe('buildMarkdownReport — metas sem medição', () => {
  it('meta cuja métrica nunca foi medida mostra travessão, não zero', () => {
    const goal: Goal = {
      id: 'g1',
      title: 'Reduzir desvio de afinação',
      createdAt: '2026-03-01T10:00:00.000Z',
      targetDate: null,
      metric: 'pitchDriftSt',
      target: 0.5,
      relativeTo: 'absoluto',
      baselineValue: null,
      status: 'ativa',
      note: '',
    };
    const md = buildMarkdownReport(
      {
        ...createInitialData(),
        goals: [goal],
        sessions: [session({ metrics: makeMetrics({ pitchDriftSt: null }) })],
      },
      todasAsOpcoes,
    );
    expect(md).toContain('Reduzir desvio de afinação');
    expect(md).toMatch(/alvo 0\.5 st, atual —/);
  });
});

describe('evolutionTable — métricas ausentes', () => {
  it('métrica sem medição nas duas pontas aparece como travessão, não como zero', () => {
    const md = buildMarkdownReport(
      {
        ...createInitialData(),
        sessions: [
          session({ metrics: makeMetrics({ hnrMedianDb: null, pitchDriftSt: null }) }),
          session({
            createdAt: '2026-03-05T10:00:00.000Z',
            metrics: makeMetrics({ hnrMedianDb: null, pitchDriftSt: null }),
          }),
        ],
      },
      todasAsOpcoes,
    );
    expect(md).toMatch(/\| clareza \(harmônico\/ruído\) \| — \| — \| — \|/);
  });

  it('variação negativa de estabilidade vem com sinal', () => {
    const md = buildMarkdownReport(
      {
        ...createInitialData(),
        sessions: [
          session({ metrics: makeMetrics({ f0Stability: 80 }) }),
          session({
            createdAt: '2026-03-05T10:00:00.000Z',
            metrics: makeMetrics({ f0Stability: 70 }),
          }),
        ],
      },
      todasAsOpcoes,
    );
    expect(md).toMatch(/estabilidade de altura \| 80\.0 \| 70\.0 \| -10\.0 \|/);
  });
});
