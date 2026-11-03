/**
 * Geração de relatórios de evolução (Markdown e HTML autocontido).
 * Nada é enviado para servidores: o arquivo é escrito apenas onde o usuário
 * escolher, depois de confirmação explícita.
 */
import { AppData, SessionRecord } from '../../shared/types';
import { RANGE_LABEL_TEXT } from '../assessment/profile';
import { METRIC_LABEL, METRIC_UNIT, metricValue } from '../training/evaluate';
import { moduleSummary } from '../training/recommender';
import { hzToSemitones, noteName } from '../utils/math';

const n = (v: number | null, digits = 0): string =>
  v === null || !Number.isFinite(v) ? '—' : v.toFixed(digits);

export interface ReportOptions {
  includeJournal: boolean;
  includeSessions: number; // quantas sessões recentes listar
  includeGoals: boolean;
}

export function buildMarkdownReport(data: AppData, opts: ReportOptions): string {
  const lines: string[] = [];
  const p = data.profile;
  lines.push('# Relatório de evolução vocal — Prisma Vocal');
  lines.push('');
  lines.push(`Gerado em ${new Date().toLocaleString('pt-BR')}.`);
  lines.push('');
  lines.push('> Este relatório contém **medidas acústicas e estimativas** produzidas pelo app.');
  lines.push(
    '> Não é um diagnóstico clínico. Se houver dor, rouquidão persistente ou perda de extensão, procure avaliação profissional.',
  );
  lines.push('');

  if (p) {
    lines.push('## Perfil vocal');
    lines.push('');
    lines.push(
      `- Classificação descritiva: **${RANGE_LABEL_TEXT[p.rangeLabel]}** (apenas descritiva, não uma meta)`,
    );
    lines.push(`- Piso estimado: ${n(p.floorHz)} Hz (${p.floorHz ? noteName(p.floorHz) : '—'})`);
    lines.push(
      `- Teto estimado: ${n(p.ceilingHz)} Hz (${p.ceilingHz ? noteName(p.ceilingHz) : '—'})`,
    );
    lines.push(
      `- Centro confortável: ${n(p.comfortableHz)} Hz (${p.comfortableHz ? noteName(p.comfortableHz) : '—'})`,
    );
    lines.push(`- Extensão medida: ${n(p.rangeSt, 1)} semitons`);
    if (p.strengths.length) {
      lines.push('');
      lines.push('**Pontos fortes:**');
      p.strengths.forEach((s) => lines.push(`- ${s}`));
    }
    if (p.challenges.length) {
      lines.push('');
      lines.push('**Pontos a trabalhar:**');
      p.challenges.forEach((s) => lines.push(`- ${s}`));
    }
    lines.push('');
  } else {
    lines.push('## Perfil vocal');
    lines.push('');
    lines.push(
      'Avaliação inicial ainda não concluída — os valores abaixo se baseiam apenas nas sessões registradas.',
    );
    lines.push('');
  }

  const recent = data.sessions.slice(-Math.max(1, opts.includeSessions));
  if (recent.length) {
    lines.push('## Sessões recentes');
    lines.push('');
    lines.push(
      '| Data | Tipo | Duração | Altura mediana | Extensão | Estabilidade | Ressonância | Nota |',
    );
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const s of recent) {
      lines.push(
        `| ${new Date(s.createdAt).toLocaleDateString('pt-BR')} | ${s.kind} | ${n(s.durationSec, 1)} s | ${n(s.metrics.f0MedianHz)} Hz | ${n(s.metrics.f0RangeSt, 1)} st | ${s.metrics.f0Stability}/100 | ${s.metrics.resonanceIndex}/100 | ${s.score === null ? '—' : s.score} |`,
      );
    }
    lines.push('');
    lines.push(evolutionTable(data.sessions));
    lines.push('');
  }

  lines.push('## Progresso no treino');
  lines.push('');
  for (const m of moduleSummary(data.progress, data.settings.mode)) {
    lines.push(`- ${m.title}: ${m.done}/${m.lessons} aulas (${m.completion}%)`);
  }
  lines.push('');

  if (opts.includeGoals && data.goals.length) {
    lines.push('## Metas');
    lines.push('');
    for (const g of data.goals) {
      const current = latestMetric(data.sessions, g.metric);
      lines.push(
        `- **${g.title}** — alvo ${g.target} ${METRIC_UNIT[g.metric]}, atual ${current === null ? '—' : n(current, 1)} (${g.status})`,
      );
    }
    lines.push('');
  }

  if (opts.includeJournal && data.journal.length) {
    lines.push('## Diário vocal');
    lines.push('');
    for (const j of data.journal.slice(-20)) {
      lines.push(
        `- ${new Date(j.date).toLocaleDateString('pt-BR')} · humor ${j.mood}/5 · energia ${j.energy}/5 — ${j.notes || '(sem nota)'}`,
      );
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('Feito com Prisma Vocal — yuki-dev-bit · https://github.com/yuki-dev-bit');
  return lines.join('\n');
}

function latestMetric(
  sessions: SessionRecord[],
  metric: Parameters<typeof metricValue>[1],
): number | null {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const v = metricValue(sessions[i].metrics, metric);
    if (v !== null) return v;
  }
  return null;
}

function evolutionTable(sessions: SessionRecord[]): string {
  if (sessions.length < 2) return '_Ainda não há sessões suficientes para calcular evolução._';
  const first = sessions[0].metrics;
  const last = sessions[sessions.length - 1].metrics;
  const rows: string[] = [
    '### Evolução (primeira × última sessão)',
    '',
    '| Métrica | Primeira | Última | Variação |',
    '| --- | --- | --- | --- |',
  ];
  const metrics = ['f0MedianHz', 'resonanceIndex', 'f0Stability', 'hnrDb', 'prosodySt'] as const;
  for (const m of metrics) {
    const a = metricValue(first, m);
    const b = metricValue(last, m);
    const delta = a !== null && b !== null ? b - a : null;
    const deltaText =
      m === 'f0MedianHz' && a && b
        ? `${hzToSemitones(b) - hzToSemitones(a) > 0 ? '+' : ''}${(hzToSemitones(b) - hzToSemitones(a)).toFixed(1)} st`
        : delta === null
          ? '—'
          : `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`;
    rows.push(`| ${METRIC_LABEL[m]} | ${n(a, 1)} | ${n(b, 1)} | ${deltaText} |`);
  }
  return rows.join('\n');
}

/** Relatório HTML autocontido (sem recursos externos, seguro para abrir offline). */
export function buildHtmlReport(data: AppData, opts: ReportOptions): string {
  const md = buildMarkdownReport(data, opts);
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = md
    .split('\n')
    .map((line) => {
      if (line.startsWith('### ')) return `<h3>${escape(line.slice(4))}</h3>`;
      if (line.startsWith('## ')) return `<h2>${escape(line.slice(3))}</h2>`;
      if (line.startsWith('# ')) return `<h1>${escape(line.slice(2))}</h1>`;
      if (line.startsWith('> ')) return `<blockquote>${escape(line.slice(2))}</blockquote>`;
      if (line.startsWith('- ')) return `<li>${escape(line.slice(2))}</li>`;
      if (line.startsWith('|')) {
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
        if (cells.every((c) => /^-+$/.test(c.replace(/:/g, '')))) return '';
        return `<tr>${cells.map((c) => `<td>${escape(c)}</td>`).join('')}</tr>`;
      }
      if (line.trim() === '') return '';
      return `<p>${escape(line)}</p>`;
    })
    .join('\n')
    .replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, (m) => `<ul>${m}</ul>`)
    .replace(/(<tr>[\s\S]*?<\/tr>)(?!\s*<tr>)/g, (m) => `<table>${m}</table>`);

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório — Prisma Vocal</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:48px 24px; background:#0b0d12; color:#e8eaf2;
         font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  main { max-width: 820px; margin: 0 auto; }
  h1 { font-size: 28px; letter-spacing:-0.02em; }
  h2 { margin-top: 36px; font-size: 20px; color:#9ecbff; border-bottom:1px solid #1e2331; padding-bottom:8px; }
  h3 { font-size: 17px; color:#f5a9b8; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0 24px; font-size: 14px; }
  td, th { border: 1px solid #1e2331; padding: 6px 10px; text-align: left; }
  blockquote { border-left: 3px solid #5bcefa; margin: 12px 0; padding: 4px 16px; color:#a9b0c6; background:#11141c; }
  li { margin: 2px 0; }
  code { background:#141926; padding:2px 5px; border-radius:4px; }
  footer { margin-top:48px; color:#767e96; font-size:13px; }
</style></head>
<body><main>
${body}
<footer>Prisma Vocal · yuki-dev-bit · github.com/yuki-dev-bit — processamento 100% local.</footer>
</main></body></html>`;
}
