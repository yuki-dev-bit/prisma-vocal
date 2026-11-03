/**
 * Regras puras da calibração de microfone (dBFS → dB SPL).
 *
 * Ficam fora do componente de interface para poderem ser testadas sem DOM e para
 * que a tela de Configurações e o diálogo guiado usem exatamente o mesmo cálculo.
 */

/** Abaixo disso o ambiente está silencioso demais para calcular offset. */
export const MIN_CALIBRATION_LEVEL_DB = -70;
/** Teto de segurança do offset (dBFS→dBSPL). */
export const MAX_CALIBRATION_OFFSET_DB = 120;
/** Faixa aceita para o valor lido no medidor de SPL. */
export const MIN_SPL_DB = 30;
export const MAX_SPL_DB = 120;

/**
 * Offset = SPL medido no aparelho externo − nível que o app leu (dBFS).
 *
 * Exemplo real: microfone de celular lendo −40 dBFS enquanto o decibelímetro
 * marca 62 dB SPL ⇒ offset de 102 dB. Por isso o teto antigo de 60 dB truncava
 * a maioria das calibrações.
 */
export function computeCalibrationOffset(levelDb: number, measuredSplDb: number): number {
  if (!Number.isFinite(levelDb) || !Number.isFinite(measuredSplDb)) return 0;
  const raw = measuredSplDb - levelDb;
  const clamped = Math.min(MAX_CALIBRATION_OFFSET_DB, Math.max(0, raw));
  return Math.round(clamped * 10) / 10;
}

/** O nível é utilizável para calibrar? (som presente e não silencioso) */
export function isCalibrationLevelUsable(levelDb: number | null): levelDb is number {
  return levelDb !== null && Number.isFinite(levelDb) && levelDb >= MIN_CALIBRATION_LEVEL_DB;
}

/** Data legível e curta, no idioma da interface. */
export function formatCalibratedAt(iso: string | null, locale = 'pt-BR'): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleString(locale === 'en' ? 'en-US' : 'pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
