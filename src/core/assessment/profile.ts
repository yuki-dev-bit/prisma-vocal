/**
 * Protocolo de avaliação inicial e construção do perfil vocal.
 *
 * Princípios de design (importantes para não reproduzir vieses):
 *  • Nenhuma etapa exige um valor absoluto de frequência. Tudo é medido em
 *    relação ao próprio chão/teto da pessoa.
 *  • O rótulo de tessitura é DESCRITIVO (onde a voz fala), não prescritivo.
 *  • "Dificuldades" são descrições de comportamento acústico no momento da
 *    avaliação, não traços permanentes nem diagnósticos.
 */
import {
  AssessmentStepId,
  AssessmentStepResult,
  RangeLabel,
  RegisterPoint,
  SessionMetrics,
  TrainingMode,
  VoiceProfile,
} from '../../shared/types';
import { clamp, hzToSemitones, noteName } from '../utils/math';

export interface AssessmentStepSpec {
  id: AssessmentStepId;
  title: string;
  /** Instrução curta mostrada em destaque. */
  instruction: string;
  /** Explicação de por que a etapa existe. */
  rationale: string;
  durationSec: number;
  /** Tipo de exercício usado pelo motor de áudio. */
  kind: 'fala' | 'sustentado' | 'glissando' | 'livre';
  /** Sugestão de referência musical (só informativa). */
  hint: string;
  optional?: boolean;
}

export const ASSESSMENT_PROTOCOL: AssessmentStepSpec[] = [
  {
    id: 'fala-natural',
    title: 'Fala natural',
    instruction:
      'Leia o texto em voz alta, no seu volume e altura de sempre. Não tente "soar melhor" — queremos justamente o seu jeito natural.',
    rationale:
      'Mede a altura confortável da sua fala, a variação melódica e a constância do volume. É a linha de base de tudo que vem depois.',
    durationSec: 30,
    kind: 'fala',
    hint: 'Se travar, fale sobre o que você fez ontem.',
  },
  {
    id: 'vogal-confortavel',
    title: 'Vogal sustentada confortável',
    instruction:
      'Sustente um "aaa" (como em "casa") numa nota confortável, sem esforço, por cerca de 5 segundos. Repita 3 vezes, respirando entre elas.',
    rationale:
      'Dá uma amostra estável para estimar soprosidade, estabilidade e o ponto de partida da sua ressonância.',
    durationSec: 18,
    kind: 'sustentado',
    hint: 'Volume de conversa. Se a voz falhar no fim, diminua a intensidade.',
  },
  {
    id: 'glissando-descida',
    title: 'Deslize até o grave',
    instruction:
      'Comece numa nota confortável e deslize lentamente para baixo, em "aaa", até onde conseguir sem raspar nem doer. Suba de volta.',
    rationale:
      'Encontra o seu piso de voz atual, que define o tamanho real da sua tessitura e permite calibrar metas realistas.',
    durationSec: 15,
    kind: 'glissando',
    hint: 'Qualquer nota serve como início. O app mede em relação a você.',
  },
  {
    id: 'glissando-subida',
    title: 'Deslize até o agudo',
    instruction:
      'Da mesma nota confortável, deslize lentamente para cima em "aaa" até o limite confortável (sem gritar, sem apertar).',
    rationale:
      'Encontra o seu teto atual. Junto com o piso, define a extensão usada nas metas e nos exercícios.',
    durationSec: 15,
    kind: 'glissando',
    hint: 'Pare antes do esforço. Desconforto não é progresso.',
  },
  {
    id: 'ressonancia-escura',
    title: 'Ressonância mais escura',
    instruction:
      'Fale a mesma frase de antes, mas com a voz "mais no peito", mais grave e abafada. Sem forçar a garganta.',
    rationale:
      'Mede o quanto você consegue escurecer o timbre. O controle voluntário de ressonância é um dos pontos mais treináveis da voz.',
    durationSec: 20,
    kind: 'fala',
    hint: 'Imagine falar num ambiente grande e ecoante.',
  },
  {
    id: 'ressonancia-clara',
    title: 'Ressonância mais clara',
    instruction:
      'Agora a mesma frase com a voz "para frente", mais brilhante e leve, como se sorrisse ao falar. Sem apertar a garganta.',
    rationale:
      'Mede o outro extremo do seu controle de ressonância. A distância entre os dois extremos é o que chamamos de alcance timbrístico.',
    durationSec: 20,
    kind: 'fala',
    hint: 'Pense no som de "oi!" alegre e leve.',
  },
  {
    id: 'controle-altura',
    title: 'Controle de altura',
    instruction:
      'Sustente uma nota um pouco acima da sua fala confortável (2 a 3 semitons) por 4 segundos, sem escorregar. Repita 3 vezes.',
    rationale:
      'Avalia controle fino de altura — prever e manter uma nota é diferente de simplesmente alcançá-la.',
    durationSec: 15,
    kind: 'sustentado',
    hint: 'Use a referência de nota do app se precisar.',
  },
];

/** Faixas DESCRITIVAS da altura de fala (não são metas nem ideais). */
export function describeRange(comfortableHz: number | null): RangeLabel {
  if (!comfortableHz || comfortableHz <= 0) return 'media';
  if (comfortableHz < 110) return 'grave';
  if (comfortableHz < 147) return 'medio-grave';
  if (comfortableHz < 197) return 'media';
  if (comfortableHz < 262) return 'medio-aguda';
  return 'aguda';
}

export const RANGE_LABEL_TEXT: Record<RangeLabel, string> = {
  grave: 'voz grave',
  'medio-grave': 'voz média-grave',
  media: 'voz média',
  'medio-aguda': 'voz média-aguda',
  aguda: 'voz aguda',
  ampla: 'voz de extensão ampla',
};

function stepMetrics(steps: AssessmentStepResult[], id: AssessmentStepId): SessionMetrics | null {
  return steps.find((s) => s.stepId === id)?.metrics ?? null;
}

/**
 * Detecta pontos de transição de registro a partir dos glissandos.
 * Heurística: trechos onde a altura "salta" (>7 st) entre quadros vizinhos
 * confiáveis, agrupados por proximidade.
 */
export function detectRegisterPoints(
  frames: { t: number; f0: number | null; f0Confidence: number }[],
): RegisterPoint[] {
  const points: RegisterPoint[] = [];
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1];
    const b = frames[i];
    if (!a.f0 || !b.f0) continue;
    if (a.f0Confidence < 0.65 || b.f0Confidence < 0.65) continue;
    if (b.t - a.t > 0.25) continue;
    const jump = Math.abs(hzToSemitones(b.f0) - hzToSemitones(a.f0));
    if (jump > 7) {
      points.push({
        hz: Math.round(b.f0),
        semitonesFromC3: Number(hzToSemitones(b.f0).toFixed(2)),
        noteName: noteName(b.f0),
        confidence: 0.5,
      });
    }
  }
  // agrupa pontos próximos (< 3 semitons) mantendo o de maior confiança
  const merged: RegisterPoint[] = [];
  for (const p of points) {
    const near = merged.find((m) => Math.abs(m.semitonesFromC3 - p.semitonesFromC3) < 3);
    if (near) {
      near.confidence = Math.min(1, near.confidence + 0.15);
    } else {
      merged.push({ ...p });
    }
  }
  return merged.slice(0, 4);
}

export interface ProfileComputation {
  profile: VoiceProfile;
  notes: string[];
}

/**
 * Constrói o perfil vocal a partir dos resultados da avaliação.
 * Tolerante a etapas faltantes: usa o que existir e marca o resto como null.
 */
export function buildProfile(args: {
  steps: AssessmentStepResult[];
  mode: TrainingMode;
  framesByStep?: Partial<
    Record<AssessmentStepId, { t: number; f0: number | null; f0Confidence: number }[]>
  >;
}): ProfileComputation {
  const { steps } = args;
  const notes: string[] = [];
  const natural = stepMetrics(steps, 'fala-natural');
  const vowel = stepMetrics(steps, 'vogal-confortavel');
  const down = stepMetrics(steps, 'glissando-descida');
  const up = stepMetrics(steps, 'glissando-subida');
  const dark = stepMetrics(steps, 'ressonancia-escura');
  const bright = stepMetrics(steps, 'ressonancia-clara');

  const comfortable = natural?.f0MedianHz ?? vowel?.f0MedianHz ?? null;
  const floor = down?.f0P5Hz ?? down?.f0MinHz ?? null;
  const ceiling = up?.f0P95Hz ?? up?.f0MaxHz ?? null;

  let rangeSt = 0;
  if (floor && ceiling && ceiling > floor)
    rangeSt = Number((12 * Math.log2(ceiling / floor)).toFixed(1));
  else if (natural?.f0P5Hz && natural?.f0P95Hz)
    rangeSt = Number((12 * Math.log2(natural.f0P95Hz / natural.f0P5Hz)).toFixed(1));

  const centerPosition =
    floor && ceiling && comfortable && ceiling > floor
      ? Math.round(
          100 *
            clamp((12 * Math.log2(comfortable / floor)) / (12 * Math.log2(ceiling / floor)), 0, 1),
        )
      : 50;

  const strengths: string[] = [];
  const challenges: string[] = [];

  if (vowel) {
    if ((vowel.hnrMedianDb ?? 0) >= 18)
      strengths.push('Som com bastante componente periódico (pouco ar na voz).');
    else if ((vowel.hnrMedianDb ?? 99) < 12)
      challenges.push('Soprosidade alta na vogal sustentada — a voz "escapa" em ar.');
    if (vowel.f0Stability >= 70) strengths.push('Boa estabilidade de altura em nota sustentada.');
    else challenges.push('Altura oscilou durante a nota sustentada.');
    if (vowel.levelStability >= 70) strengths.push('Volume constante ao sustentar a nota.');
    else if (vowel.levelStability < 55) challenges.push('Volume caiu ao longo da nota sustentada.');
  }
  if (natural) {
    if (natural.prosodySt >= 5) strengths.push('Melodia de fala variada (entonação viva).');
    else if (natural.prosodySt < 3)
      challenges.push('Entonação pouco variada na leitura — soa mais monótona.');
    if (natural.registerBreaks > 4)
      challenges.push('Quebras de registro frequentes durante a fala.');
  }
  if (dark && bright) {
    const range = Math.abs(bright.resonanceIndex - dark.resonanceIndex);
    if (range >= 15) strengths.push('Bom alcance de timbre entre claro e escuro.');
    else
      challenges.push(
        'Pouca diferença entre o timbre claro e o escuro (controle de ressonância ainda pequeno).',
      );
  } else {
    notes.push('Etapas de ressonância não concluídas: o perfil não inclui alcance timbrístico.');
  }
  if (steps.some((s) => s.metrics.qualityFlags.includes('ruido-alto'))) {
    notes.push(
      'Ambiente com ruído alto em pelo menos uma etapa — os valores podem estar subestimados.',
    );
  }
  if (steps.some((s) => s.metrics.qualityFlags.includes('clipping'))) {
    notes.push('Houve clipping em pelo menos uma etapa: reduza o ganho de entrada e refaça.');
  }
  if (!floor || !ceiling) {
    notes.push('Sem glissandos completos, a extensão vocal não pôde ser estimada.');
  }

  const registerMap = args.framesByStep
    ? Object.values(args.framesByStep).flatMap((f) => (f ? detectRegisterPoints(f) : []))
    : [];

  return {
    profile: {
      floorHz: floor,
      ceilingHz: ceiling,
      comfortableHz: comfortable,
      rangeSt,
      rangeLabel: rangeSt >= 30 ? 'ampla' : describeRange(comfortable),
      centerPosition,
      registerMap: registerMap.slice(0, 5),
      strengths,
      challenges,
      assessedAt: new Date().toISOString(),
    },
    notes,
  };
}

/**
 * Metas sugeridas — sempre apresentadas como sugestão editável.
 * As faixas numéricas são referências relativas ao próprio perfil.
 */
export interface SuggestedGoal {
  title: string;
  metric: 'f0MedianHz' | 'resonanceIndex' | 'prosodySt' | 'hnrDb' | 'f0Stability';
  target: number;
  relativeTo: 'baseline' | 'absoluto';
  rationale: string;
}

export function suggestGoals(profile: VoiceProfile, mode: TrainingMode): SuggestedGoal[] {
  const goals: SuggestedGoal[] = [];
  const base = profile.comfortableHz;
  if (mode === 'mtf') {
    if (base) {
      goals.push({
        title: `Falar com centro ~${formatSt(base, 2)} acima do atual`,
        metric: 'f0MedianHz',
        target: Math.round(base * Math.pow(2, 2 / 12)),
        relativeTo: 'baseline',
        rationale:
          'Dois semitons costumam ser um primeiro passo sustentável. Não é um valor obrigatório — metas maiores são possíveis com mais tempo.',
      });
    }
    goals.push({
      title: 'Aumentar o brilho/ressonância frontal sem apertar',
      metric: 'resonanceIndex',
      target: Math.min(100, (profile.rangeSt > 0 ? 45 : 40) + 10),
      relativeTo: 'baseline',
      rationale:
        'Ressonância frontal tende a mudar a percepção de timbre mais que a altura isolada.',
    });
  } else if (mode === 'ftm') {
    if (base) {
      goals.push({
        title: `Falar com centro ~${formatSt(base, -2)} abaixo do atual`,
        metric: 'f0MedianHz',
        target: Math.round(base * Math.pow(2, -2 / 12)),
        relativeTo: 'baseline',
        rationale:
          'Descer de forma gradual preserva a saúde vocal. Ganhos de peso e ressonância contam tanto quanto a altura.',
      });
    }
    goals.push({
      title: 'Fortalecer a presença grave e o peso vocal',
      metric: 'hnrDb',
      target: 15,
      relativeTo: 'absoluto',
      rationale:
        'Sinal mais periódico e com mais peso dá sensação de corpo mesmo sem descer muito a altura.',
    });
  }
  goals.push({
    title: 'Manter estabilidade de altura acima de 70/100',
    metric: 'f0Stability',
    target: 70,
    relativeTo: 'absoluto',
    rationale: 'Estabilidade é o que permite usar mudanças de altura na fala real sem quebras.',
  });
  return goals;
}

function formatSt(hz: number, st: number): string {
  const target = hz * Math.pow(2, st / 12);
  return `${st > 0 ? '+' : ''}${st} st (${Math.round(target)} Hz, ${noteName(target)})`;
}
