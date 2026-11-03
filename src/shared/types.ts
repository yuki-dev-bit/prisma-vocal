/**
 * Contratos de dados compartilhados entre processo principal (Electron),
 * renderer (React) e o núcleo de análise (`src/core`).
 *
 * Regra de ouro deste arquivo: nenhum tipo aqui depende de DOM ou de Node,
 * para que possa ser importado/testado em qualquer ambiente.
 */

export type TrainingMode = 'mtf' | 'ftm' | 'shared';

/** Faixa de tessitura descritiva — nunca um julgamento de valor. */
export type RangeLabel = 'grave' | 'medio-grave' | 'media' | 'medio-aguda' | 'aguda' | 'ampla';

export type ExerciseKind =
  'sustentado' | 'glissando' | 'escala' | 'leitura' | 'fala' | 'livre' | 'comparacao';

export type MetricId =
  | 'f0MedianHz'
  | 'f0RangeSt'
  | 'f0Stability'
  | 'levelDb'
  | 'levelSd'
  | 'levelStability'
  | 'hnrDb'
  | 'brightness'
  | 'resonanceIndex'
  | 'breathiness'
  | 'prosodySt'
  | 'voicedRatio'
  | 'clippingRatio'
  | 'formantF1Hz'
  | 'formantF2Hz'
  | 'formantDispersionHz'
  | 'tiltDbPerOct'
  | 'pitchDriftSt'
  | 'registerBreaks';

export type MetricOp = '>=' | '<=' | 'entre' | 'estavel';

export interface MetricTarget {
  metric: MetricId;
  op: MetricOp;
  /** Valor-alvo absoluto (quando aplicável). */
  value?: number;
  /** Limite inferior para `entre`. */
  min?: number;
  /** Limite superior para `entre`. */
  max?: number;
  /**
   * Quando `true`, o alvo é relativo à linha de base do próprio usuário
   * (f0 median, brilho etc.), em vez de um número absoluto.
   */
  relative?: 'baselineF0' | 'baselineBrightness' | 'selfRange';
  /** Deslocamento em semitons (para alvos relativos de f0). */
  semitones?: number;
  /** Peso relativo na nota do exercício (0..1). */
  weight: number;
  label: string;
}

/* ------------------------------------------------------------------ */
/* Métricas                                                            */
/* ------------------------------------------------------------------ */

/** Métricas de um único quadro de análise (≈16 ms). */
export interface FrameMetrics {
  /** Tempo em segundos desde o início do stream. */
  t: number;
  /** Frequência fundamental em Hz, ou null se não vozeado. */
  f0: number | null;
  /** Confiança do detector de f0 (0..1). */
  f0Confidence: number;
  voiced: boolean;
  /** Nível RMS em dBFS (0 = fundo de escala digital). */
  levelDb: number;
  /** Estimativa de nível em dB SPL, apenas se calibrado. */
  splDb: number | null;
  /** Relação harmônico-ruído em dB (método de autocorrelação). */
  hnrDb: number | null;
  /** F1..F4 estimados por LPC, em Hz (null quando não confiáveis). */
  formants: [number, number, number, number] | null;
  /** Centroide espectral em Hz. */
  centroidHz: number;
  /** Inclinação espectral em dB/oitava (negativa = mais escura). */
  tiltDbPerOct: number;
  /** Diferença H1-H2 em dB (proxy de peso/contato de pregas). */
  h1h2Db: number | null;
  /** Índice de soprosidade estimado (0..1). */
  breathiness: number;
  /** Índice de brilho/ressonância frontal (0..100, relativo). */
  resonanceIndex: number;
  /** Planura espectral (0..1) — ruído tende a 1. */
  spectralFlatness: number;
  /** Detecção de clipping nesta janela. */
  clipping: boolean;
  /**
   * 18 bandas espectrais (80 Hz–8 kHz, escala log) normalizadas em 0..1,
   * usadas apenas para desenhar o espectrograma do HUD. Não são medidas
   * calibradas e não devem ser exportadas como análise.
   */
  bands?: number[];
}

/** Estatísticas agregadas de uma sessão/gravação. */
export interface SessionMetrics {
  durationSec: number;
  voicedRatio: number;
  f0MedianHz: number | null;
  f0MeanHz: number | null;
  f0P5Hz: number | null;
  f0P95Hz: number | null;
  f0MinHz: number | null;
  f0MaxHz: number | null;
  /** Extensão usada na sessão, em semitons. */
  f0RangeSt: number;
  /** Desvio-padrão de f0 em semitons (proxy de estabilidade e prosódia). */
  f0SdSt: number;
  /** Índice de estabilidade 0..100 (quanto maior, mais estável). */
  f0Stability: number;
  /** Desvio de afinação em relação a uma nota-alvo (semitons), quando houver alvo. */
  pitchDriftSt: number | null;
  levelMedianDb: number | null;
  levelSdDb: number;
  levelStability: number;
  hnrMedianDb: number | null;
  breathiness: number;
  brightness: number;
  resonanceIndex: number;
  tiltDbPerOct: number | null;
  formantF1Hz: number | null;
  formantF2Hz: number | null;
  formantDispersionHz: number | null;
  /** Faixa de prosódia (p90-p10 de f0 em semitons) para fala encadeada. */
  prosodySt: number;
  clippingRatio: number;
  /** Nº de mudanças bruscas de altura (>6 st em <120 ms). */
  registerBreaks: number;
  /** Nº de quadros analisados. */
  frames: number;
  /** Avisos de qualidade de captura. */
  qualityFlags: QualityFlag[];
}

export type QualityFlag =
  | 'sinal-baixo'
  | 'clipping'
  | 'ruido-alto'
  | 'pouco-sinal-voz'
  | 'amostra-curta'
  | 'nivel-inconsistente'
  | 'sem-calibracao';

export interface QualityReport {
  ok: boolean;
  flags: QualityFlag[];
  snrDb: number | null;
  noiseFloorDb: number | null;
  peakDb: number | null;
  clippingRatio: number;
  message: string;
}

/* ------------------------------------------------------------------ */
/* Perfil e avaliação                                                  */
/* ------------------------------------------------------------------ */

export interface VoiceProfile {
  floorHz: number | null;
  ceilingHz: number | null;
  /** Centro confortável da fala (mediana). */
  comfortableHz: number | null;
  rangeSt: number;
  rangeLabel: RangeLabel;
  /** 0 = no chão da própria voz, 100 = no teto. Posição do centro confortável. */
  centerPosition: number;
  registerMap: RegisterPoint[];
  strengths: string[];
  challenges: string[];
  assessedAt: string | null;
}

export interface RegisterPoint {
  /** Hz onde o registro aparenta mudar. */
  hz: number;
  /** Nota aproximada em semitons a partir de C3 (130.81 Hz). */
  semitonesFromC3: number;
  noteName: string;
  confidence: number;
}

export type AssessmentStepId =
  | 'fala-natural'
  | 'vogal-confortavel'
  | 'glissando-subida'
  | 'glissando-descida'
  | 'ressonancia-clara'
  | 'ressonancia-escura'
  | 'controle-altura';

export interface AssessmentStepResult {
  stepId: AssessmentStepId;
  recordedAt: string;
  durationSec: number;
  metrics: SessionMetrics;
  /** Observação curta e não-diagnóstica. */
  note: string;
}

export interface AssessmentRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  mode: TrainingMode;
  steps: AssessmentStepResult[];
  profile: VoiceProfile | null;
}

/* ------------------------------------------------------------------ */
/* Treino                                                              */
/* ------------------------------------------------------------------ */

export interface LessonExercise {
  id: string;
  kind: ExerciseKind;
  title: string;
  /** Instrução principal, em passos curtos. */
  steps: string[];
  durationSec: number;
  /** Alvos relativos ao próprio usuário. */
  targets: MetricTarget[];
  /** Texto de apoio mostrado durante o exercício. */
  cue: string;
  /** Erros comuns e como corrigir. */
  pitfalls: string[];
  /** Se true, o app toca/usa uma referência de nota. */
  needsReferencePitch?: boolean;
}

export interface Lesson {
  id: string;
  moduleId: string;
  mode: TrainingMode;
  title: string;
  objective: string;
  why: string;
  estimatedMinutes: number;
  level: 1 | 2 | 3 | 4 | 5;
  exercises: LessonExercise[];
  /** Pré-requisitos (ids de aulas). */
  requires?: string[];
}

export interface TrainingModule {
  id: string;
  mode: TrainingMode;
  title: string;
  subtitle: string;
  description: string;
  order: number;
  accent: 'blue' | 'pink' | 'white' | 'mint';
  lessons: Lesson[];
}

export interface LessonResult {
  lessonId: string;
  exerciseId: string;
  completedAt: string;
  score: number;
  metrics: SessionMetrics;
  targetsMet: { target: MetricTarget; met: boolean; actual: number | null }[];
  feedbackIds: string[];
}

export interface ModuleProgress {
  moduleId: string;
  completedLessons: string[];
  lastPracticedAt: string | null;
}

export interface ProgressState {
  lessons: Record<string, { attempts: number; bestScore: number; lastAt: string }>;
  modules: Record<string, ModuleProgress>;
  streakDays: number;
  lastPracticeDate: string | null;
  totalPracticeMinutes: number;
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

export type FeedbackSeverity = 'sucesso' | 'atencao' | 'dica' | 'info';

export interface FeedbackItem {
  id: string;
  severity: FeedbackSeverity;
  title: string;
  /** O que foi observado (dados concretos). */
  what: string;
  /** Por que isso importa tecnicamente. */
  why: string;
  /** Como praticar agora. */
  how: string;
  /** Métricas relacionadas, para exibir números. */
  evidence: { label: string; value: string }[];
}

/* ------------------------------------------------------------------ */
/* Gravações, diário, metas                                            */
/* ------------------------------------------------------------------ */

export interface RecordingMeta {
  id: string;
  createdAt: string;
  label: string;
  kind: ExerciseKind | 'avaliacao' | 'comparacao';
  lessonId?: string;
  durationSec: number;
  sampleRate: number;
  encrypted: boolean;
  metrics: SessionMetrics | null;
  tags: string[];
}

export interface ComparisonResult {
  a: SessionMetrics;
  b: SessionMetrics;
  deltas: {
    metric: MetricId;
    label: string;
    a: number | null;
    b: number | null;
    delta: number | null;
    unit: string;
    better: 'up' | 'down' | 'either';
  }[];
  summary: string[];
}

export interface JournalEntry {
  id: string;
  date: string;
  mood: 1 | 2 | 3 | 4 | 5;
  energy: 1 | 2 | 3 | 4 | 5;
  notes: string;
  tags: string[];
  metrics?: Partial<SessionMetrics>;
}

export interface Goal {
  id: string;
  title: string;
  createdAt: string;
  targetDate: string | null;
  metric: MetricId;
  /** Alvo absoluto ou relativo à linha de base. */
  target: number;
  relativeTo: 'absoluto' | 'baseline';
  baselineValue: number | null;
  status: 'ativa' | 'concluida' | 'pausada';
  note: string;
}

export interface ReminderSettings {
  enabled: boolean;
  time: string; // 'HH:MM'
  weekdays: number[]; // 0..6
  message: string;
}

/* ------------------------------------------------------------------ */
/* Configurações                                                       */
/* ------------------------------------------------------------------ */

export interface AudioSettings {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  gainDb: number;
  inputSensitivity: number;
  noiseSuppression: boolean;
  noiseGateThresholdDb: number;
  monitoring: boolean;
  monitoringVolume: number;
  latencyHint: 'interactive' | 'balanced' | 'playback';
  requestedSampleRate: number;
  /** dBFS → dB SPL. 0 significa "não calibrado". */
  calibrationOffsetDb: number;
  /**
   * ISO da última calibração concluída e salva (null = nunca calibrado).
   * Serve para mostrar ao usuário *quando* a calibração foi feita — o offset
   * sozinho não distingue "calibrado hoje" de "calibrado há seis meses".
   */
  calibratedAt: string | null;
  /** O usuário dispensou o convite de calibração na tela inicial. */
  calibrationPromptDismissed: boolean;
  clippingWarning: boolean;
  autoGain: boolean;
}

export interface UiSettings {
  theme: 'escuro' | 'claro' | 'sistema';
  accentIntensity: number;
  fontScale: number;
  highContrast: boolean;
  reducedMotion: boolean;
  showSpectrogram: boolean;
  showFormants: boolean;
  showHarmonicGrid: boolean;
  hudDensity: 'compacto' | 'confortavel' | 'amplo';
  colorBlindSafe: boolean;
  language: 'pt-BR' | 'en';
}

export interface PrivacySettings {
  storeRecordings: boolean;
  retentionDays: number; // 0 = manter até exclusão manual
  telemetry: false; // permanentemente desativado — offline por design
  requireConsentForExport: boolean;
}

export interface AppSettings {
  mode: TrainingMode;
  audio: AudioSettings;
  ui: UiSettings;
  privacy: PrivacySettings;
  reminders: ReminderSettings;
  /** Frequência de referência usada para tocar notas (A4). */
  a4Hz: number;
}

export interface UserSummary {
  displayName: string;
  createdAt: string;
  /** Faixa auto-relatada (opcional, não usada para julgamento). */
  selfDescription: string;
  goalsStatement: string;
}

/* ------------------------------------------------------------------ */
/* Sessões                                                             */
/* ------------------------------------------------------------------ */

export interface SessionRecord {
  id: string;
  createdAt: string;
  mode: TrainingMode;
  kind: ExerciseKind | 'avaliacao' | 'livre';
  lessonId?: string;
  exerciseId?: string;
  durationSec: number;
  metrics: SessionMetrics;
  score: number | null;
  recordingId: string | null;
  feedback: FeedbackItem[];
}

export interface AppData {
  schemaVersion: number;
  user: UserSummary;
  settings: AppSettings;
  profile: VoiceProfile | null;
  assessment: AssessmentRun | null;
  progress: ProgressState;
  sessions: SessionRecord[];
  recordings: RecordingMeta[];
  journal: JournalEntry[];
  goals: Goal[];
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

export interface SaveRecordingPayload {
  meta: Omit<RecordingMeta, 'encrypted'>;
  /** PCM float32 mono @ sampleRate — transferido como ArrayBuffer. */
  pcm: ArrayBuffer;
}
