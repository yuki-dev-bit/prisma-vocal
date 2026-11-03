/**
 * Configurações padrão, presets de voz e validação (saneamento) de entradas.
 *
 * Os presets existem porque voz grave de verdade (baixo profundo) pede faixa
 * de análise, gate e ganho diferentes de uma voz aguda. O preset padrão cobre
 * toda a faixa de 40 a 1200 Hz; os demais apenas otimizam precisão/ruído.
 */
import {
  AppSettings,
  AudioSettings,
  TrainingMode,
  UiSettings,
  VoiceProfile,
} from '../../shared/types';

export const DEFAULT_AUDIO: AudioSettings = {
  inputDeviceId: null,
  outputDeviceId: null,
  gainDb: 0,
  inputSensitivity: 1,
  noiseSuppression: false, // padrão desligado: preserva medidas acústicas
  noiseGateThresholdDb: -55,
  monitoring: false,
  monitoringVolume: 0.5,
  latencyHint: 'interactive',
  requestedSampleRate: 48000,
  calibrationOffsetDb: 0,
  calibratedAt: null,
  calibrationPromptDismissed: false,
  clippingWarning: true,
  autoGain: false,
};

export const DEFAULT_UI: UiSettings = {
  theme: 'escuro',
  accentIntensity: 1,
  fontScale: 1,
  highContrast: false,
  reducedMotion: false,
  showSpectrogram: true,
  showFormants: true,
  showHarmonicGrid: true,
  hudDensity: 'confortavel',
  colorBlindSafe: false,
  language: 'pt-BR',
};

export const DEFAULT_SETTINGS: AppSettings = {
  mode: 'shared',
  audio: DEFAULT_AUDIO,
  ui: DEFAULT_UI,
  privacy: {
    storeRecordings: true,
    retentionDays: 0,
    telemetry: false,
    requireConsentForExport: true,
  },
  reminders: {
    enabled: false,
    time: '19:00',
    weekdays: [1, 3, 5],
    message: 'Hora de cuidar da sua voz por 10 minutos.',
  },
  a4Hz: 440,
};

export interface VoicePreset {
  id: string;
  label: string;
  description: string;
  analysis: { minF0: number; maxF0: number };
  hud: { minHz: number; maxHz: number };
  audio: Partial<AudioSettings>;
}

export const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'universal',
    label: 'Universal (padrão)',
    description:
      'Faixa de análise de 40 a 1200 Hz: cobre de baixo profundo a vozes muito agudas. Bom ponto de partida.',
    analysis: { minF0: 40, maxF0: 1200 },
    hud: { minHz: 40, maxHz: 1000 },
    audio: {},
  },
  {
    id: 'baixo-profundo',
    label: 'Baixo profundo / muito grave',
    description:
      'Faixa 30–600 Hz com ganho inicial +6 dB e gate mais baixo. Evita que notas abaixo de 60 Hz sejam lidas como ruído.',
    analysis: { minF0: 30, maxF0: 600 },
    hud: { minHz: 30, maxHz: 400 },
    audio: { gainDb: 6, noiseGateThresholdDb: -58, inputSensitivity: 1.15 },
  },
  {
    id: 'grave',
    label: 'Grave / barítono',
    description: 'Faixa 40–700 Hz, ganho +3 dB.',
    analysis: { minF0: 40, maxF0: 700 },
    hud: { minHz: 40, maxHz: 500 },
    audio: { gainDb: 3 },
  },
  {
    id: 'media',
    label: 'Média / fala cotidiana',
    description: 'Faixa 60–900 Hz, sem ganho extra.',
    analysis: { minF0: 60, maxF0: 900 },
    hud: { minHz: 60, maxHz: 700 },
    audio: {},
  },
  {
    id: 'aguda',
    label: 'Aguda / leve',
    description: 'Faixa 80–1400 Hz: mais resolução para vozes altas, onde harmônicos são esparsos.',
    analysis: { minF0: 80, maxF0: 1400 },
    hud: { minHz: 80, maxHz: 1200 },
    audio: { gainDb: -3 },
  },
];

export function presetForProfile(profile: VoiceProfile | null): VoicePreset {
  const hz = profile?.comfortableHz;
  if (!hz) return VOICE_PRESETS[0];
  if (hz < 90) return VOICE_PRESETS[1];
  if (hz < 130) return VOICE_PRESETS[2];
  if (hz < 210) return VOICE_PRESETS[3];
  return VOICE_PRESETS[4];
}

export function presetById(id: string): VoicePreset {
  return VOICE_PRESETS.find((p) => p.id === id) ?? VOICE_PRESETS[0];
}

const TRAINING_MODES = ['mtf', 'ftm', 'shared'] as const satisfies readonly TrainingMode[];
const UI_THEMES = ['escuro', 'claro', 'sistema'] as const;
const HUD_DENSITIES = ['compacto', 'confortavel', 'amplo'] as const;
const LATENCY_HINTS = ['interactive', 'balanced', 'playback'] as const;
const SAMPLE_RATES = [44100, 48000, 96000] as const;

const clampNum = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** Aceita só um dos valores previstos; qualquer outra coisa cai no padrão. */
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

/** O mesmo para listas numéricas fechadas (taxas de amostragem). */
const oneOfNumber = (v: unknown, allowed: readonly number[], fallback: number): number =>
  typeof v === 'number' && allowed.includes(v) ? v : fallback;

/** Aceita apenas ISO 8601 válido; qualquer outra coisa vira `null`. */
const isoOrNull = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.length < 10) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
const str = (v: unknown, fallback: string, maxLen = 200): string =>
  typeof v === 'string' ? v.slice(0, maxLen) : fallback;

/**
 * Saneia qualquer objeto vindo do disco/IPC. Nunca confia em tipos: dados
 * corrompidos ou editados à mão não devem quebrar o app nem permitir valores
 * absurdos (ganho de 200 dB, taxa de 1 Hz etc.).
 */
export function sanitizeSettings(raw: unknown): { settings: AppSettings; changed: boolean } {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const audioSrc = (src.audio ?? {}) as Record<string, unknown>;
  const uiSrc = (src.ui ?? {}) as Record<string, unknown>;
  const privSrc = (src.privacy ?? {}) as Record<string, unknown>;
  const remSrc = (src.reminders ?? {}) as Record<string, unknown>;

  const audio: AudioSettings = {
    inputDeviceId:
      typeof audioSrc.inputDeviceId === 'string' ? audioSrc.inputDeviceId.slice(0, 128) : null,
    outputDeviceId:
      typeof audioSrc.outputDeviceId === 'string' ? audioSrc.outputDeviceId.slice(0, 128) : null,
    gainDb: clampNum(audioSrc.gainDb, -24, 24, DEFAULT_AUDIO.gainDb),
    inputSensitivity: clampNum(audioSrc.inputSensitivity, 0.2, 3, DEFAULT_AUDIO.inputSensitivity),
    noiseSuppression: bool(audioSrc.noiseSuppression, DEFAULT_AUDIO.noiseSuppression),
    noiseGateThresholdDb: clampNum(
      audioSrc.noiseGateThresholdDb,
      -80,
      -30,
      DEFAULT_AUDIO.noiseGateThresholdDb,
    ),
    monitoring: bool(audioSrc.monitoring, DEFAULT_AUDIO.monitoring),
    monitoringVolume: clampNum(audioSrc.monitoringVolume, 0, 1, DEFAULT_AUDIO.monitoringVolume),
    latencyHint: oneOf(audioSrc.latencyHint, LATENCY_HINTS, DEFAULT_AUDIO.latencyHint),
    requestedSampleRate: oneOfNumber(
      audioSrc.requestedSampleRate,
      SAMPLE_RATES,
      DEFAULT_AUDIO.requestedSampleRate,
    ),
    // Um offset dBFS→dB SPL realista fica entre 60 e 100 dB (o microfone lê
    // ~-40 dBFS onde o mundo tem 60 dB SPL). O teto antigo de 60 dB truncava a
    // calibração de quase todo mundo em silêncio, e a estimativa de SPL saía
    // 30-40 dB abaixo do real — o que parecia "calibração não salva".
    calibrationOffsetDb: clampNum(audioSrc.calibrationOffsetDb, 0, 120, 0),
    calibratedAt: isoOrNull(audioSrc.calibratedAt),
    calibrationPromptDismissed: bool(audioSrc.calibrationPromptDismissed, false),
    clippingWarning: bool(audioSrc.clippingWarning, DEFAULT_AUDIO.clippingWarning),
    autoGain: bool(audioSrc.autoGain, DEFAULT_AUDIO.autoGain),
  };

  const ui: UiSettings = {
    theme: oneOf(uiSrc.theme, UI_THEMES, DEFAULT_UI.theme),
    accentIntensity: clampNum(uiSrc.accentIntensity, 0, 1.5, DEFAULT_UI.accentIntensity),
    fontScale: clampNum(uiSrc.fontScale, 0.85, 1.6, DEFAULT_UI.fontScale),
    highContrast: bool(uiSrc.highContrast, DEFAULT_UI.highContrast),
    reducedMotion: bool(uiSrc.reducedMotion, DEFAULT_UI.reducedMotion),
    showSpectrogram: bool(uiSrc.showSpectrogram, DEFAULT_UI.showSpectrogram),
    showFormants: bool(uiSrc.showFormants, DEFAULT_UI.showFormants),
    showHarmonicGrid: bool(uiSrc.showHarmonicGrid, DEFAULT_UI.showHarmonicGrid),
    hudDensity: oneOf(uiSrc.hudDensity, HUD_DENSITIES, DEFAULT_UI.hudDensity),
    colorBlindSafe: bool(uiSrc.colorBlindSafe, DEFAULT_UI.colorBlindSafe),
    language: uiSrc.language === 'en' ? 'en' : 'pt-BR',
  };

  const weekdays = Array.isArray(remSrc.weekdays)
    ? remSrc.weekdays.filter(
        (d: unknown) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6,
      )
    : DEFAULT_SETTINGS.reminders.weekdays;

  const settings: AppSettings = {
    mode: oneOf(src.mode, TRAINING_MODES, DEFAULT_SETTINGS.mode),
    audio,
    ui,
    privacy: {
      storeRecordings: bool(privSrc.storeRecordings, true),
      retentionDays: clampNum(privSrc.retentionDays, 0, 3650, 0),
      telemetry: false,
      requireConsentForExport: bool(privSrc.requireConsentForExport, true),
    },
    reminders: {
      enabled: bool(remSrc.enabled, false),
      time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(remSrc.time)) ? String(remSrc.time) : '19:00',
      weekdays: weekdays.length ? weekdays : [1, 3, 5],
      message: str(remSrc.message, DEFAULT_SETTINGS.reminders.message, 120),
    },
    a4Hz: clampNum(src.a4Hz, 415, 466, 440),
  };

  const changed = JSON.stringify(settings) !== JSON.stringify(raw);
  return { settings, changed };
}
