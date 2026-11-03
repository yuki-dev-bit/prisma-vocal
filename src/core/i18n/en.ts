/**
 * English UI strings. Long-form editorial content (curriculum, feedback text,
 * assessment protocol) is still Portuguese-only in this release — see
 * docs/LIMITATIONS.md for the translation plan.
 */
import type { Dict } from './index';

export const en: Dict = {
  appName: 'Prisma Vocal',
  tagline: 'Voice training with your data, on your machine.',
  navHome: 'Home',
  navAnalyze: 'Analyze',
  navTrain: 'Train',
  navAssess: 'Assessment',
  navRecordings: 'Recordings',
  navJournal: 'Journal',
  navProgress: 'Progress',
  navSettings: 'Settings',

  modeMtf: 'Feminization (MTF)',
  modeFtm: 'Masculinization (FTM)',
  modeShared: 'Shared tools',
  modeLabel: 'Training mode',

  start: 'Start',
  stop: 'Stop',
  pause: 'Pause',
  resume: 'Resume',
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  close: 'Close',
  back: 'Back',
  next: 'Next',
  finish: 'Finish',
  retry: 'Retry',
  play: 'Play',
  record: 'Record',
  export: 'Export',
  import: 'Import',
  confirm: 'Confirm',
  loading: 'Loading…',
  none: '—',

  micIdle: 'Microphone idle',
  micLive: 'Capturing live',
  micDenied: 'Microphone permission denied',
  micMissing: 'No microphone found',
  micRetryHint: 'Check your system permissions and try again.',
  deviceSelect: 'Input device',
  outputSelect: 'Monitoring output',
  gain: 'Input gain',
  sensitivity: 'Sensitivity',
  noiseReduction: 'Noise reduction',
  noiseGate: 'Noise gate',
  monitoring: 'Monitoring',
  monitoringHint: 'Use headphones to avoid feedback.',
  latency: 'Latency',
  calibration: 'Calibration',
  calibrationHint:
    'Compare the level the app reads with an SPL meter to convert dBFS into estimated dB SPL.',
  clipping: 'Clipping',
  clippingDetected: 'Signal clipped — lower the gain',
  levelOk: 'Good level',
  levelLow: 'Low level',

  hudPitch: 'Pitch (F0)',
  hudResonance: 'Resonance',
  hudLevel: 'Intensity',
  hudHnr: 'Clarity (HNR)',
  hudBreath: 'Breathiness',
  hudStability: 'Stability',
  hudFormants: 'Formants',
  hudSpectrogram: 'Spectrogram',
  hudTarget: 'Target range',
  hudSession: 'Session',

  metricAcoustic: 'Acoustic measure',
  metricEstimate: 'Perceptual estimate',
  disclaimer:
    'These are acoustic estimates to track your own progress. They are not a diagnosis and do not predict how others perceive your voice.',

  trainingNextStep: 'Recommended next step',
  trainingExercises: 'Exercises',
  trainingObjective: 'Objective',
  trainingWhy: 'Why it matters',
  trainingPitfalls: 'Common mistakes',
  trainingDuration: 'Duration',
  trainingTargets: 'Targets for this practice',
  trainingScore: 'Score',
  trainingCompleted: 'Completed',
  trainingLocked: 'Finish the previous steps',
  trainingStartExercise: 'Practice now',

  assessIntroTitle: 'Initial assessment',
  assessIntroBody:
    'Seven short steps to map your voice today: floor, ceiling, comfortable center, resonance and control. Takes about 4 minutes and can be repeated anytime.',
  assessResultTitle: 'Assessment result',
  assessRestart: 'Redo assessment',

  recordingsEmpty: 'No recordings yet. Record a take in the Analyze tab.',
  compareTitle: 'Compare before and after',
  compareSelectA: 'Take A (before)',
  compareSelectB: 'Take B (after)',

  journalNew: 'New note',
  journalMood: 'How did your voice sound?',
  journalEnergy: 'Energy level',
  journalNotes: 'Notes',
  journalEmpty: 'No notes yet. Recording context helps interpret progress.',

  goalsTitle: 'Goals',
  goalsNew: 'New goal',
  goalsActive: 'Active',
  goalsDone: 'Done',

  privacyTitle: 'Privacy and data',
  privacyLocal: 'All processing is local. The app never uploads audio.',
  privacyRecordings: 'Store recordings',
  privacyRetention: 'Delete recordings after (days)',
  privacyDeleteAll: 'Delete all my data',
  privacyDeleteAllWarn:
    'This removes recordings, sessions, journal, goals and profile from this device. It cannot be undone.',
  encryptedStorage: 'Encrypted recordings (AES-256-GCM)',

  browserModeTitle: 'Browser mode (local)',
  browserModeBody:
    'You are running the renderer in a browser. Data lives in this browser storage and is not encrypted. The desktop build (Electron) uses encrypted storage on disk.',
  unsupportedBrowser: 'This browser does not expose audio capture. Use the desktop build.',

  a11yTitle: 'Accessibility',
  a11yFontScale: 'Text size',
  a11yHighContrast: 'High contrast',
  a11yReducedMotion: 'Reduce motion',
  a11yColorBlind: 'Color-blind safe palette',
  shortcutHelp: 'Shortcuts',

  errorGeneric: 'Something went wrong.',
  errorAudioInit: 'Could not start audio.',
  errorStorage: 'Could not save data.',
  errorNoProfile: 'Run the initial assessment to unlock relative goals.',

  madeBy: 'by yuki-dev-bit',
};
