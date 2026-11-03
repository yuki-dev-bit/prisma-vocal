/**
 * Calibração: persistência, limites e efeito no SPL.
 *
 * Cobre os três defeitos encontrados na auditoria:
 *  1. o teto de 60 dB truncava offsets reais (60–100 dB), então a estimativa de
 *     SPL saía dezenas de dB abaixo do medidor externo — o usuário lia isso como
 *     "a calibração não foi salva";
 *  2. `calibratedAt` não existia: não havia como provar *quando* a calibração
 *     foi feita, nem distinguir "calibrado" de "padrão";
 *  3. o analisador só lia o offset no construtor: calibrar durante a captura não
 *     mudava o SPL ao vivo até reiniciar.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO, sanitizeSettings } from '@core/settings/defaults';
import { migrateData, createInitialData } from '@core/storage/repository';
import { VoiceAnalyzer } from '@core/analysis/analyzer';
import {
  computeCalibrationOffset,
  formatCalibratedAt,
  isCalibrationLevelUsable,
  MAX_CALIBRATION_OFFSET_DB,
} from '@core/audio/calibration';
import { harmonicTone } from './helpers/synth';

describe('sanitizeSettings — calibração', () => {
  it('preserva offsets realistas acima do antigo teto de 60 dB', () => {
    const { settings } = sanitizeSettings({ audio: { calibrationOffsetDb: 92.4 } });
    expect(settings.audio.calibrationOffsetDb).toBe(92.4);
  });

  it('limita ao teto de segurança e nunca aceita negativo', () => {
    expect(
      sanitizeSettings({ audio: { calibrationOffsetDb: 500 } }).settings.audio.calibrationOffsetDb,
    ).toBe(MAX_CALIBRATION_OFFSET_DB);
    expect(
      sanitizeSettings({ audio: { calibrationOffsetDb: -12 } }).settings.audio.calibrationOffsetDb,
    ).toBe(0);
    expect(
      sanitizeSettings({ audio: { calibrationOffsetDb: 'abc' } }).settings.audio
        .calibrationOffsetDb,
    ).toBe(0);
  });

  it('normaliza calibratedAt e descarta valores inválidos', () => {
    const ok = sanitizeSettings({ audio: { calibratedAt: '2026-10-31T12:00:00.000Z' } }).settings
      .audio.calibratedAt;
    expect(ok).toBe('2026-10-31T12:00:00.000Z');
    expect(
      sanitizeSettings({ audio: { calibratedAt: 'ontem' } }).settings.audio.calibratedAt,
    ).toBeNull();
    expect(sanitizeSettings({ audio: {} }).settings.audio.calibratedAt).toBeNull();
  });

  it('mantém o padrão consistente (não calibrado, convite ativo)', () => {
    expect(DEFAULT_AUDIO.calibrationOffsetDb).toBe(0);
    expect(DEFAULT_AUDIO.calibratedAt).toBeNull();
    expect(DEFAULT_AUDIO.calibrationPromptDismissed).toBe(false);
  });
});

describe('persistência após reabrir o app', () => {
  it('mantém offset, data e dispensa do convite ao migrar os dados gravados', () => {
    const saved = createInitialData();
    saved.settings.audio.calibrationOffsetDb = 87.5;
    saved.settings.audio.calibratedAt = '2026-10-31T15:30:00.000Z';
    saved.settings.audio.calibrationPromptDismissed = true;

    // ida e volta pelo armazenamento (é o que a bridge faz: JSON no disco)
    const restored = migrateData(JSON.parse(JSON.stringify(saved)));
    expect(restored.issues).toEqual([]);
    expect(restored.data.settings.audio.calibrationOffsetDb).toBe(87.5);
    expect(restored.data.settings.audio.calibratedAt).toBe('2026-10-31T15:30:00.000Z');
    expect(restored.data.settings.audio.calibrationPromptDismissed).toBe(true);
  });

  it('não inventa calibração para dados antigos sem os campos novos', () => {
    const legacy = {
      schemaVersion: 1,
      settings: { audio: { gainDb: 3 } },
    };
    const { data } = migrateData(legacy);
    expect(data.settings.audio.gainDb).toBe(3);
    expect(data.settings.audio.calibrationOffsetDb).toBe(0);
    expect(data.settings.audio.calibratedAt).toBeNull();
  });
});

describe('VoiceAnalyzer — offset aplicado em tempo real', () => {
  it('passa a reportar splDb quando a calibração é aplicada com a captura rodando', () => {
    const fs = 48000;
    const analyzer = new VoiceAnalyzer({ fs });
    const signal = harmonicTone(140, fs, 0.5, 12, 0.3);

    const before = analyzer.push(signal);
    expect(before.length).toBeGreaterThan(0);
    expect(before[before.length - 1].splDb).toBeNull(); // sem calibração

    analyzer.setCalibrationOffset(88);
    const after = analyzer.push(harmonicTone(140, fs, 0.3, 12, 0.3));
    const last = after[after.length - 1];
    expect(last.splDb).not.toBeNull();
    expect(last.splDb! - last.levelDb).toBeCloseTo(88, 1);
  });

  it('volta a esconder o SPL quando a calibração é removida', () => {
    const fs = 48000;
    const analyzer = new VoiceAnalyzer({ fs, calibrationOffsetDb: 70 });
    analyzer.push(harmonicTone(150, fs, 0.4));
    analyzer.setCalibrationOffset(0);
    const frames = analyzer.push(harmonicTone(150, fs, 0.3));
    expect(frames[frames.length - 1].splDb).toBeNull();
  });
});

describe('computeCalibrationOffset', () => {
  it('calcula offset = SPL medido − nível do app', () => {
    expect(computeCalibrationOffset(-42, 78)).toBe(120); // 78 − (−42) = 120 (no teto)
    expect(computeCalibrationOffset(-18, 60)).toBe(78);
    expect(computeCalibrationOffset(-30, 75)).toBe(105);
  });

  it('nunca devolve valor negativo nem acima do teto', () => {
    expect(computeCalibrationOffset(-10, -20)).toBe(0); // SPL abaixo do nível ⇒ offset negativo ⇒ 0
    expect(computeCalibrationOffset(-60, 120)).toBe(MAX_CALIBRATION_OFFSET_DB);
  });

  it('arredonda a 0,1 dB para não guardar lixo numérico', () => {
    expect(computeCalibrationOffset(-20.06, 70)).toBe(90.1);
  });

  it('só aceita calibrar com som presente', () => {
    expect(isCalibrationLevelUsable(-12)).toBe(true);
    expect(isCalibrationLevelUsable(-69.9)).toBe(true);
    expect(isCalibrationLevelUsable(-90)).toBe(false);
    expect(isCalibrationLevelUsable(null)).toBe(false);
  });
});

describe('formatCalibratedAt', () => {
  it('mostra data e hora no idioma da interface', () => {
    const iso = '2026-10-31T15:30:00.000Z';
    expect(formatCalibratedAt(iso, 'pt-BR')).toMatch(/31\/10\/2026/);
    expect(formatCalibratedAt(iso, 'en')).toMatch(/10\/31\/2026/);
  });

  it('devolve null para valor ausente ou inválido', () => {
    expect(formatCalibratedAt(null)).toBeNull();
    expect(formatCalibratedAt('ontem')).toBeNull();
  });
});
