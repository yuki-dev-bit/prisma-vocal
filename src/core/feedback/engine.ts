/**
 * Motor de feedback: transforma métricas em orientação acionável.
 *
 * Cada item responde a três perguntas: O QUE foi observado (com número),
 * POR QUE importa (mecanismo) e COMO praticar (ação concreta).
 *
 * Regra de produto: nenhuma dica se baseia exclusivamente na frequência
 * fundamental. Altura é uma dimensão entre várias — ressonância, apoio,
 * articulação e prosódia sempre entram na análise.
 */
import { ExerciseKind, FeedbackItem, SessionMetrics } from '../../shared/types';
import type { TargetOutcome } from '../training/evaluate';
import { METRIC_UNIT } from '../training/evaluate';

export interface FeedbackContext {
  metrics: SessionMetrics;
  targets?: TargetOutcome[];
  kind?: ExerciseKind | 'avaliacao' | 'livre';
  baseline?: { f0: number | null; brightness: number | null };
  calibration?: boolean;
}

const fmt = (v: number | null, unit = '', digits = 0): string =>
  v === null || !Number.isFinite(v) ? '—' : `${v.toFixed(digits)}${unit ? ` ${unit}` : ''}`;

const isSpeech = (kind: FeedbackContext['kind']) =>
  kind === 'fala' || kind === 'leitura' || kind === 'livre';

export function generateFeedback(ctx: FeedbackContext): FeedbackItem[] {
  const m = ctx.metrics;
  const items: FeedbackItem[] = [];
  const push = (item: FeedbackItem) => {
    if (items.length < 7) items.push(item);
  };

  /* ---------------- Captura e qualidade de sinal ---------------- */

  if (m.qualityFlags.includes('clipping')) {
    push({
      id: 'clipping',
      severity: 'atencao',
      title: 'Sinal saturando (clipping)',
      what: `${(m.clippingRatio * 100).toFixed(1)}% dos quadros têm amostras no teto digital.`,
      why: 'Clipping gera harmônicos falsos: os índices de brilho, soprosidade e HNR ficam distorcidos e a análise perde validade.',
      how: 'Reduza o ganho de entrada em Configurações → Áudio em uns 6 dB, afaste-se ~5 cm do microfone e repita. Se ainda saturar, desligue o ganho automático.',
      evidence: [{ label: 'clipping', value: `${(m.clippingRatio * 100).toFixed(1)}%` }],
    });
  }

  if (m.qualityFlags.includes('sinal-baixo')) {
    push({
      id: 'sinal-baixo',
      severity: 'atencao',
      title: 'Sinal muito baixo',
      what: `O nível mediano ficou em ${fmt(m.levelMedianDb, 'dBFS', 1)}.`,
      why: 'Com sinal baixo, o ruído do próprio microfone se mistura à voz e as estimativas de f0 e formantes ficam instáveis.',
      how: 'Aumente o ganho de entrada (Configurações → Áudio) até o pico ficar entre −12 e −6 dBFS e fique a um palmo do microfone.',
      evidence: [{ label: 'nível mediano', value: fmt(m.levelMedianDb, 'dBFS', 1) }],
    });
  }

  if (m.qualityFlags.includes('ruido-alto')) {
    push({
      id: 'ruido',
      severity: 'dica',
      title: 'Ambiente com ruído',
      what: 'A diferença entre o silêncio e a voz ficou pequena (ruído de fundo alto).',
      why: 'Ruído reduz a confiança do detector de altura e mascara a soprosidade real da sua voz.',
      how: 'Prefira um cômodo com cortinas/estofados, use fones (evita realimentação) e considere ativar a redução de ruído. Em último caso, aproxime o microfone.',
      evidence: [{ label: 'ruído', value: 'alto' }],
    });
  }

  if (m.qualityFlags.includes('amostra-curta')) {
    push({
      id: 'amostra-curta',
      severity: 'info',
      title: 'Amostra curta',
      what: `Foram analisados apenas ${m.durationSec.toFixed(1)} s.`,
      why: 'Estatísticas de estabilidade e extensão precisam de pelo menos 3–5 segundos de voz.',
      how: 'Repita mantendo o som por mais tempo — de preferência 6 segundos ou mais.',
      evidence: [],
    });
  }

  if (m.voicedRatio < 0.15 && !m.qualityFlags.includes('amostra-curta')) {
    push({
      id: 'pouca-voz',
      severity: 'atencao',
      title: 'Pouco trecho de voz detectado',
      what: `Só ${(m.voicedRatio * 100).toFixed(0)}% do tempo foi reconhecido como voz.`,
      why: 'Pausas longas ou volume baixo fazem o detector descartar quadros — o resultado fica incompleto.',
      how: 'Tente manter o som contínuo durante todo o exercício, mesmo baixinho, e confira se o microfone selecionado é o certo.',
      evidence: [{ label: 'voz detectada', value: `${(m.voicedRatio * 100).toFixed(0)}%` }],
    });
  }

  /* ---------------- Metas do exercício ---------------- */

  const outcomes = ctx.targets ?? [];
  const met = outcomes.filter((o) => o.met && !o.unresolved);
  const missed = outcomes.filter((o) => !o.met && !o.unresolved);

  if (outcomes.length > 0 && met.length === outcomes.length) {
    push({
      id: 'metas-ok',
      severity: 'sucesso',
      title: 'Todas as metas do exercício foram cumpridas',
      what: met.map((o) => `${o.target.label} (${o.display})`).join(' · '),
      why: 'Cumprir metas quantitativas indica que o ajuste está estável, não só que aconteceu uma vez.',
      how: 'Aumente um pouco a dificuldade: repita em outra vogal, em volume menor ou em frase mais longa.',
      evidence: met.map((o) => ({ label: o.target.label, value: o.display })),
    });
  }

  for (const o of missed) {
    const unit = METRIC_UNIT[o.target.metric];
    push({
      id: `meta-${o.target.metric}-${o.target.op}`,
      severity: 'dica',
      title: `Ainda fora da meta: ${o.target.label}`,
      what: `Alvo ${o.display}; você ficou em ${fmt(o.actual, unit, 1)}.`,
      why: explainMetric(o.target.metric),
      how: howToImprove(o.target.metric),
      evidence: [
        { label: 'alvo', value: o.display },
        { label: 'medido', value: fmt(o.actual, unit, 1) },
      ],
    });
  }

  /* ---------------- Ressonância e timbre ---------------- */

  const baseBright = ctx.baseline?.brightness ?? null;
  if (baseBright !== null && m.resonanceIndex > 0) {
    const delta = m.resonanceIndex - baseBright;
    if (delta <= -6) {
      push({
        id: 'brilho-baixo',
        severity: 'dica',
        title: 'Timbre mais escuro que o seu habitual',
        what: `Índice de ressonância ${m.resonanceIndex}/100, ${Math.abs(Math.round(delta))} pontos abaixo da sua linha de base.`,
        why: 'A cor do timbre (energia em 2–4 kHz) muda a percepção da voz mais do que a altura isolada. Escurecer sem intenção costuma vir de laringe baixa e boca pouco aberta.',
        how: 'Experimente a mesma nota em "i" e "e" pensando em vibração nas maçãs do rosto; mantenha o maxilar destravado e o volume igual.',
        evidence: [
          { label: 'ressonância', value: `${m.resonanceIndex}/100` },
          { label: 'base', value: `${Math.round(baseBright)}/100` },
        ],
      });
    } else if (delta >= 8) {
      push({
        id: 'brilho-alto',
        severity: 'sucesso',
        title: 'Timbre mais brilhante que o seu habitual',
        what: `Índice de ressonância ${m.resonanceIndex}/100, ${Math.round(delta)} pontos acima da base.`,
        why: 'Isso indica que você conseguiu mudar a cor da voz sem necessariamente mudar a altura — controle de trato vocal.',
        how: 'Fixe essa sensação e teste se ela sobrevive a frases longas e a volumes menores.',
        evidence: [{ label: 'ressonância', value: `${m.resonanceIndex}/100` }],
      });
    }
  }

  if (m.breathiness > 0.55) {
    push({
      id: 'soprosidade',
      severity: 'dica',
      title: 'Voz com bastante ar',
      what: `Índice de soprosidade ${(m.breathiness * 100).toFixed(0)}/100 e HNR mediano ${fmt(m.hnrMedianDb, 'dB', 1)}.`,
      why: 'Ar demais escapa sem vibrar as pregas; o som fica mais fraco e o esforço para ser ouvido aumenta. Soprosidade alta também reduz a projeção.',
      how: 'Faça 3 sustentações curtas de "v" (fricativa sonora) e leve para "aaa" mantendo o mesmo contato. Reduza o fluxo em vez de aumentar o volume.',
      evidence: [{ label: 'soprosidade', value: `${(m.breathiness * 100).toFixed(0)}/100` }],
    });
  }

  if (m.hnrMedianDb !== null && m.hnrMedianDb < 10 && m.breathiness <= 0.55) {
    push({
      id: 'hnr-baixo',
      severity: 'dica',
      title: 'Som com pouca periodicidade',
      what: `HNR mediano ${fmt(m.hnrMedianDb, 'dB', 1)} (abaixo de 10 dB).`,
      why: 'HNR baixo pode vir de ruído no ambiente, de voz soprosa ou de instabilidade de vibração — vale checar a captura antes de mudar a técnica.',
      how: 'Grave 3 s em silêncio total e compare o HNR. Se subir bastante, o problema era ambiente; se não, trabalhe contato suave em "v" → "a".',
      evidence: [{ label: 'HNR', value: fmt(m.hnrMedianDb, 'dB', 1) }],
    });
  }

  /* ---------------- Estabilidade e apoio ---------------- */

  if (m.f0Stability < 55 && m.voicedRatio > 0.2) {
    push({
      id: 'estabilidade',
      severity: 'dica',
      title: 'Altura oscilando',
      what: `Estabilidade ${m.f0Stability}/100 com desvio de ${fmt(m.f0SdSt, 'st', 2)} semitons.`,
      why: 'Oscilação normalmente é sinal de fluxo de ar irregular, não de "falta de ouvido". Sem fluxo constante, a nota escorrega.',
      how: 'Sustente 4 s em "a" pensando em fluxo contínuo; se cair no final, diminua a intensidade inicial em vez de empurrar mais ar.',
      evidence: [
        { label: 'estabilidade', value: `${m.f0Stability}/100` },
        { label: 'desvio', value: fmt(m.f0SdSt, 'st', 2) },
      ],
    });
  }

  if (m.levelStability < 55 && m.levelMedianDb !== null) {
    push({
      id: 'volume-instavel',
      severity: 'dica',
      title: 'Volume variando muito',
      what: `Variação de ${fmt(m.levelSdDb, 'dB', 1)} dB dentro da tomada.`,
      why: 'Volume irregular muda a percepção de confiança na fala e costuma indicar apoio irregular ou distância variável do microfone.',
      how: 'Mantenha distância fixa de um palmo e imagine "uma linha de ar" saindo sempre com a mesma pressão.',
      evidence: [{ label: 'desvio de nível', value: fmt(m.levelSdDb, 'dB', 1) }],
    });
  }

  if (m.levelMedianDb !== null && m.levelMedianDb > -12) {
    push({
      id: 'volume-alto',
      severity: 'info',
      title: 'Nível muito próximo do limite digital',
      what: `Nível mediano ${fmt(m.levelMedianDb, 'dBFS', 1)} (ideal entre −24 e −12 dBFS).`,
      why: 'Ficar acima de −12 dBFS deixa pouca margem para picos e aumenta o risco de clipping.',
      how: 'Reduza o ganho de entrada até o medidor ficar na faixa verde durante a fala normal.',
      evidence: [{ label: 'nível', value: fmt(m.levelMedianDb, 'dBFS', 1) }],
    });
  }

  /* ---------------- Prosódia (fala) ---------------- */

  if (isSpeech(ctx.kind)) {
    if (m.prosodySt < 3 && m.f0RangeSt > 0) {
      push({
        id: 'prosodia-baixa',
        severity: 'dica',
        title: 'Melodia de fala estreita',
        what: `Faixa melódica de ${fmt(m.prosodySt, 'st', 1)} (pouca variação entre a altura mais baixa e a mais alta).`,
        why: 'A entonação carrega intenção e expressividade. Uma faixa estreita pode soar monótona independentemente de a voz ser grave ou aguda.',
        how: 'Leia a mesma frase três vezes: afirmação, pergunta, surpresa. Deixe a altura variar; mantenha o volume constante.',
        evidence: [{ label: 'faixa melódica', value: fmt(m.prosodySt, 'st', 1) }],
      });
    } else if (m.prosodySt >= 6) {
      push({
        id: 'prosodia-ok',
        severity: 'sucesso',
        title: 'Boa variação melódica',
        what: `Faixa de ${fmt(m.prosodySt, 'st', 1)} semitons na fala.`,
        why: 'É a faixa típica de uma fala expressiva; ela sustenta naturalidade mesmo quando a altura média muda.',
        how: 'Guarde essa referência: se em dias cansados a faixa cair abaixo de 3 st, é sinal de descanso.',
        evidence: [{ label: 'faixa melódica', value: fmt(m.prosodySt, 'st', 1) }],
      });
    }
  }

  if (m.registerBreaks >= 3) {
    push({
      id: 'quebras-registro',
      severity: 'dica',
      title: 'Quebras de registro no trecho',
      what: `${m.registerBreaks} saltos bruscos de altura (mais de 7 semitons em menos de 200 ms).`,
      why: 'Quebras acontecem quando a coordenação muda de ajuste sem transição. Forçar ali costuma gerar aperto; suavizar é mais eficaz.',
      how: 'Faça o deslize na vogal "u", com volume baixo, passando devagar pelo ponto de quebra. Menos ar, não mais.',
      evidence: [{ label: 'quebras', value: String(m.registerBreaks) }],
    });
  }

  /* ---------------- Calibração / contexto ---------------- */

  if (ctx.calibration === false) {
    push({
      id: 'sem-calibracao',
      severity: 'info',
      title: 'Níveis em dBFS (sem calibração)',
      what: 'O app está mostrando nível digital, não dB SPL.',
      why: 'Sem calibração, não é possível comparar volume com o mundo real — apenas comparar com você mesmo.',
      how: 'Rode a calibração de microfone em Configurações → Áudio para obter estimativas em dB SPL.',
      evidence: [],
    });
  }

  /* ---------------- Próximo passo ---------------- */

  const attention = items.filter((i) => i.severity === 'atencao').length;
  if (attention === 0 && items.every((i) => i.severity !== 'dica')) {
    push({
      id: 'proximo-passo',
      severity: 'info',
      title: 'Próximo passo sugerido',
      what: 'Nada crítico apareceu nesta tomada.',
      why: 'Sem pontos de atenção, o ganho vem de aumentar a dificuldade em vez de repetir o mesmo exercício.',
      how: 'Repita o exercício numa situação mais difícil: volume menor, frase mais longa ou som nasalado.',
      evidence: [],
    });
  }

  const order: Record<FeedbackItem['severity'], number> = {
    atencao: 0,
    sucesso: 1,
    dica: 2,
    info: 3,
  };
  return items.sort((a, b) => order[a.severity] - order[b.severity]);
}

function explainMetric(metric: string): string {
  switch (metric) {
    case 'f0MedianHz':
      return 'A altura média precisa de tempo: mudar alguns semitons de forma consistente exige ajuste de coordenação, não força.';
    case 'f0Stability':
      return 'Estabilidade é pré-requisito para qualquer mudança de altura soar natural.';
    case 'resonanceIndex':
      return 'O brilho vem do trato vocal (boca, faringe, posição de língua), não do esforço da garganta.';
    case 'hnrDb':
      return 'HNR alto indica vibração regular das pregas, sem ar ou ruído competindo com o som.';
    case 'prosodySt':
      return 'Variação melódica é o que dá intenção e naturalidade à fala.';
    case 'levelStability':
    case 'levelSd':
      return 'Volume constante depende de fluxo de ar constante.';
    case 'tiltDbPerOct':
      return 'A inclinação espectral descreve o equilíbrio entre graves e agudos no seu timbre.';
    case 'voicedRatio':
      return 'Proporção de voz detectada indica se a captura está pegando o som de forma contínua.';
    case 'clippingRatio':
      return 'Clipping invalida medidas: primeiro ajuste o ganho, depois reavalie.';
    case 'breathiness':
      return 'Soprosidade alta reduz projeção e resistência vocal ao longo do dia.';
    default:
      return 'Esta medida descreve um aspecto do som que pode ser treinado separadamente.';
  }
}

function howToImprove(metric: string): string {
  switch (metric) {
    case 'f0MedianHz':
      return 'Subdivida a meta: 1 semitom por treino, sustentando 4 s antes de passar ao próximo degrau.';
    case 'f0Stability':
      return 'Sustente 4 s em "a" com fluxo contínuo e repita 5 vezes, comparando o gráfico de altura.';
    case 'resonanceIndex':
      return 'Alterne a mesma frase em timbre escuro e claro; no claro, pense em vibração frontal e maxilar solto.';
    case 'hnrDb':
      return 'Cheque o ambiente (ruído/clipping) e pratique contato suave: "v" sustentado → "a" com o mesmo contato.';
    case 'prosodySt':
      return 'Leia a frase como pergunta e como surpresa, exagerando a melodia de propósito.';
    case 'levelStability':
    case 'levelSd':
      return 'Fixe a distância do microfone e mantenha a pressão de ar constante do começo ao fim da frase.';
    case 'tiltDbPerOct':
      return 'Abra mais a boca em vogais abertas e relaxe a mandíbula; evite abaixar a laringe à força.';
    case 'voicedRatio':
      return 'Fale/grave de forma contínua, sem pausas longas, e confirme o dispositivo de entrada.';
    case 'clippingRatio':
      return 'Reduza o ganho em 6 dB ou afaste-se do microfone e repita a tomada.';
    case 'breathiness':
      return 'Reduza o fluxo de ar mantendo o volume: menos ar, mais contato.';
    default:
      return 'Repita o exercício focando em um aspecto por vez e compare as medições no histórico.';
  }
}
