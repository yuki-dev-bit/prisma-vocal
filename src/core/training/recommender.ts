/**
 * Motor de recomendação do próximo passo.
 *
 * Combina: ordem do currículo, pré-requisitos, histórico recente e as
 * dificuldades registradas na avaliação. A recomendação inclui sempre uma
 * justificativa legível e alternativas — nunca uma ordem única.
 */
import {
  Lesson,
  ProgressState,
  SessionRecord,
  TrainingMode,
  VoiceProfile,
} from '../../shared/types';
import { modulesForMode } from './curriculum';
import { isUnlocked, moduleCompletion } from './progress';

export interface Recommendation {
  lesson: Lesson;
  moduleId: string;
  moduleTitle: string;
  reason: string;
  score: number;
  alternatives: { lessonId: string; title: string; reason: string }[];
  needsAssessment: boolean;
}

const CHALLENGE_HINTS: { match: RegExp; lessons: string[]; reason: string }[] = [
  {
    match: /soprosidade|ar na voz/i,
    lessons: ['mtf-peso', 'fund-respiracao', 'ftm-peso'],
    reason:
      'Sua avaliação indicou bastante ar na voz — exercícios de apoio e contato ajudam a estabilizar.',
  },
  {
    match: /oscilou|estabilidade/i,
    lessons: ['fund-respiracao', 'mtf-degraus', 'mapa-tessitura'],
    reason:
      'A altura oscilou na última medição; sustentação com fluxo estável é o melhor caminho agora.',
  },
  {
    match: /volume|intensidade/i,
    lessons: ['fund-respiracao', 'pros-ritmo'],
    reason:
      'O volume variou muito — controle de fluxo e finais de frase estabilizam a intensidade.',
  },
  {
    match: /entona|monóton|melodia/i,
    lessons: ['pros-melodia', 'mtf-fala-altura', 'ftm-fala-baixa'],
    reason: 'Sua leitura teve pouca variação melódica; prosódia muda muito a percepção da fala.',
  },
  {
    match: /registro/i,
    lessons: ['mapa-registro'],
    reason: 'Foram detectadas quebras de registro; suavizar a transição amplia sua extensão útil.',
  },
  {
    match: /ressonância|timbre/i,
    lessons: ['res-claro-escuro', 'mtf-brilho', 'ftm-ressonancia'],
    reason:
      'O controle de timbre foi o ponto mais fraco da avaliação — é também o de maior impacto.',
  },
];

function lessonScore(args: {
  lesson: Lesson;
  index: number;
  total: number;
  progress: ProgressState;
  profile: VoiceProfile | null;
  recent: SessionRecord[];
  mode: TrainingMode;
}): { score: number; reason: string } {
  const { lesson, index, total, progress, profile, recent, mode } = args;
  let score = 100;
  const reasons: string[] = [];

  // progressão: quanto mais cedo no currículo, maior a prioridade
  score -= (index / Math.max(1, total)) * 40;

  // já praticada mas com nota baixa? volta com prioridade média
  const entry = progress.lessons[lesson.id];
  if (entry) {
    score -= 15;
    if (entry.bestScore < 60) {
      score += 25;
      reasons.push('você já praticou esta aula, mas a nota ficou abaixo de 60');
    }
  }

  // dificuldades do perfil
  if (profile) {
    for (const c of profile.challenges) {
      for (const hint of CHALLENGE_HINTS) {
        if (hint.match.test(c) && hint.lessons.includes(lesson.id)) {
          score += 30;
          reasons.push(hint.reason);
        }
      }
    }
  }

  // sessões recentes: se as métricas-alvo da aula estão fracas, sobe prioridade
  if (recent.length > 0) {
    const last = recent.slice(-3);
    const avgStability = last.reduce((a, s) => a + s.metrics.f0Stability, 0) / last.length;
    if (
      avgStability < 55 &&
      lesson.exercises.some((e) => e.targets.some((t) => t.metric === 'f0Stability'))
    ) {
      score += 12;
      reasons.push('nas últimas sessões a estabilidade de altura ficou abaixo de 55/100');
    }
    const avgRes = last.reduce((a, s) => a + s.metrics.resonanceIndex, 0) / last.length;
    if (
      profile?.comfortableHz &&
      avgRes < 35 &&
      lesson.exercises.some((e) => e.targets.some((t) => t.metric === 'resonanceIndex'))
    ) {
      score += 10;
      reasons.push('o índice de ressonância recente ficou abaixo de 35/100 (pouco brilho)');
    }
  }

  // afinidade com o modo atual
  if (lesson.mode === mode) score += 8;
  if (lesson.mode === 'shared' && mode !== 'shared') score += 3;

  // módulo já bem avançado não deve dominar
  const modDone = progress.modules[lesson.moduleId]?.completedLessons.length ?? 0;
  if (modDone >= 2) score -= 5;

  const reason =
    reasons.length > 0
      ? reasons[0]
      : entry
        ? 'é a continuação natural da sua trilha depois das aulas concluídas'
        : 'é o próximo passo da trilha na ordem recomendada';
  return { score, reason };
}

export function recommendNext(args: {
  progress: ProgressState;
  mode: TrainingMode;
  profile: VoiceProfile | null;
  sessions: SessionRecord[];
}): Recommendation | null {
  const { progress, mode, profile, sessions } = args;
  const modules = modulesForMode(mode).sort((a, b) => a.order - b.order);
  const needsAssessment = !profile;

  const candidates: {
    lesson: Lesson;
    moduleId: string;
    moduleTitle: string;
    score: number;
    reason: string;
  }[] = [];
  const ordered = modules.flatMap((m) => m.lessons.map((l) => ({ lesson: l, module: m })));
  const total = ordered.length;

  ordered.forEach(({ lesson, module }, index) => {
    if (!isUnlocked(progress, lesson.id, lesson.requires)) return;
    if (needsAssessment && module.id !== 'fundamentos') return; // antes da avaliação, só fundamentos
    const { score, reason } = lessonScore({
      lesson,
      index,
      total,
      progress,
      profile,
      recent: sessions,
      mode,
    });
    candidates.push({ lesson, moduleId: module.id, moduleTitle: module.title, score, reason });
  });

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  const alternatives = candidates
    .slice(1, 4)
    .map((c) => ({ lessonId: c.lesson.id, title: c.lesson.title, reason: c.reason }));

  return {
    lesson: best.lesson,
    moduleId: best.moduleId,
    moduleTitle: best.moduleTitle,
    reason: best.reason,
    score: Math.round(best.score),
    alternatives,
    needsAssessment,
  };
}

/** Próxima aula da mesma trilha, em ordem (usada pelo botão "continuar"). */
export function nextInOrder(progress: ProgressState, mode: TrainingMode): Lesson | null {
  const modules = modulesForMode(mode).sort((a, b) => a.order - b.order);
  for (const m of modules) {
    for (const l of m.lessons) {
      if (!(progress.modules[m.id]?.completedLessons.includes(l.id) ?? false)) return l;
    }
  }
  return null;
}

export function moduleSummary(
  progress: ProgressState,
  mode: TrainingMode,
): {
  id: string;
  title: string;
  subtitle: string;
  accent: string;
  completion: number;
  lessons: number;
  done: number;
}[] {
  return modulesForMode(mode)
    .sort((a, b) => a.order - b.order)
    .map((m) => ({
      id: m.id,
      title: m.title,
      subtitle: m.subtitle,
      accent: m.accent,
      completion: moduleCompletion(progress, m),
      lessons: m.lessons.length,
      done: progress.modules[m.id]?.completedLessons.length ?? 0,
    }));
}
