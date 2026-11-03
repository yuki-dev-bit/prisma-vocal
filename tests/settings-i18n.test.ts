import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AUDIO,
  DEFAULT_SETTINGS,
  DEFAULT_UI,
  VOICE_PRESETS,
  presetById,
  presetForProfile,
  sanitizeSettings,
} from '@core/settings/defaults';
import { AVAILABLE_LOCALES, translator } from '@core/i18n';
import { ptBR } from '@core/i18n/pt-BR';
import { en } from '@core/i18n/en';
import { makeProfile } from './helpers/metrics';

describe('presets de voz', () => {
  it('cada preset declara faixa de análise e de HUD coerentes', () => {
    expect(VOICE_PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const p of VOICE_PRESETS) {
      expect(p.analysis.minF0).toBeLessThan(p.analysis.maxF0);
      expect(p.hud.minHz).toBeLessThan(p.hud.maxHz);
      expect(p.description.length).toBeGreaterThan(20);
    }
  });

  it('escolhe o preset pela voz confortável, sem forçar a mais aguda', () => {
    expect(presetForProfile(null).id).toBe(VOICE_PRESETS[0].id);
    const ids = [80, 110, 160, 230].map(
      (hz) => presetForProfile(makeProfile({ comfortableHz: hz })).id,
    );
    expect(new Set(ids).size).toBeGreaterThan(1);
    // voz grave não recebe o preset de voz aguda
    expect(presetForProfile(makeProfile({ comfortableHz: 80 })).id).not.toBe(
      presetForProfile(makeProfile({ comfortableHz: 300 })).id,
    );
  });

  it('preset desconhecido cai no universal em vez de quebrar', () => {
    expect(presetById('nao-existe').id).toBe(VOICE_PRESETS[0].id);
    expect(presetById(VOICE_PRESETS[2].id).id).toBe(VOICE_PRESETS[2].id);
  });
});

describe('sanitizeSettings', () => {
  it('objeto vazio vira o padrão, marcado como alterado', () => {
    const { settings, changed } = sanitizeSettings({});
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(changed).toBe(true);
  });

  it('configuração já válida passa sem alteração', () => {
    const { settings, changed } = sanitizeSettings(JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(changed).toBe(false);
  });

  it('limita ganho, sensibilidade e volume aos intervalos seguros', () => {
    const { settings } = sanitizeSettings({
      audio: { gainDb: 500, inputSensitivity: 0, monitoringVolume: 9 },
    });
    expect(settings.audio.gainDb).toBe(24);
    expect(settings.audio.inputSensitivity).toBe(0.2);
    expect(settings.audio.monitoringVolume).toBe(1);
  });

  it('aceita offset de calibração realista e rejeita absurdo', () => {
    expect(
      sanitizeSettings({ audio: { calibrationOffsetDb: 95 } }).settings.audio.calibrationOffsetDb,
    ).toBe(95);
    expect(
      sanitizeSettings({ audio: { calibrationOffsetDb: -50 } }).settings.audio.calibrationOffsetDb,
    ).toBe(0);
    expect(
      sanitizeSettings({ audio: { calibrationOffsetDb: 500 } }).settings.audio.calibrationOffsetDb,
    ).toBe(120);
  });

  it('valor não numérico cai no padrão em vez de virar NaN', () => {
    const { settings } = sanitizeSettings({ audio: { gainDb: 'muito', inputSensitivity: {} } });
    expect(settings.audio.gainDb).toBe(DEFAULT_AUDIO.gainDb);
    expect(settings.audio.inputSensitivity).toBe(DEFAULT_AUDIO.inputSensitivity);
    expect(Number.isNaN(settings.audio.gainDb)).toBe(false);
  });

  it('só aceita enums previstos', () => {
    const { settings } = sanitizeSettings({
      mode: 'outro',
      ui: { theme: 'neon', hudDensity: 'apertado', language: 'de' },
      audio: { latencyHint: 'rapido', requestedSampleRate: 22050 },
    });
    expect(settings.mode).toBe('shared');
    expect(settings.ui.theme).toBe(DEFAULT_UI.theme);
    expect(settings.ui.hudDensity).toBe(DEFAULT_UI.hudDensity);
    expect(settings.ui.language).toBe('pt-BR');
    expect(settings.audio.latencyHint).toBe(DEFAULT_AUDIO.latencyHint);
    expect(settings.audio.requestedSampleRate).toBe(DEFAULT_AUDIO.requestedSampleRate);
  });

  it('mantém booleano só quando é booleano de verdade', () => {
    const { settings } = sanitizeSettings({
      audio: { noiseSuppression: 'true', monitoring: true },
    });
    expect(settings.audio.noiseSuppression).toBe(false); // string não vira true
    expect(settings.audio.monitoring).toBe(true);
  });

  it('normaliza data de calibração e descarta texto inválido', () => {
    expect(
      sanitizeSettings({ audio: { calibratedAt: '2026-03-01T10:00:00.000Z' } }).settings.audio
        .calibratedAt,
    ).toBe('2026-03-01T10:00:00.000Z');
    expect(
      sanitizeSettings({ audio: { calibratedAt: 'ontem' } }).settings.audio.calibratedAt,
    ).toBeNull();
    expect(
      sanitizeSettings({ audio: { calibratedAt: 1234 } }).settings.audio.calibratedAt,
    ).toBeNull();
  });

  it('corta ids de dispositivo muito longos', () => {
    const { settings } = sanitizeSettings({ audio: { inputDeviceId: 'x'.repeat(500) } });
    expect(settings.audio.inputDeviceId?.length).toBe(128);
  });

  it('valida horário e dias do lembrete', () => {
    const { settings } = sanitizeSettings({
      reminders: { time: '25:99', weekdays: [1, 9, -1, 'x', 3] },
    });
    expect(settings.reminders.time).toBe('19:00');
    expect(settings.reminders.weekdays).toEqual([1, 3]);

    const ok = sanitizeSettings({ reminders: { time: '07:30', weekdays: [0, 6] } }).settings;
    expect(ok.reminders.time).toBe('07:30');
    expect(ok.reminders.weekdays).toEqual([0, 6]);
  });

  it('lista de dias vazia ou ausente volta ao padrão', () => {
    expect(sanitizeSettings({ reminders: { weekdays: [] } }).settings.reminders.weekdays).toEqual([
      1, 3, 5,
    ]);
    expect(sanitizeSettings({}).settings.reminders.weekdays).toEqual(
      DEFAULT_SETTINGS.reminders.weekdays,
    );
  });

  it('limita o texto do lembrete e a afinação de referência', () => {
    const { settings } = sanitizeSettings({
      reminders: { message: 'a'.repeat(500) },
      a4Hz: 100,
    });
    expect(settings.reminders.message.length).toBe(120);
    expect(settings.a4Hz).toBe(415);
  });

  it('desliga telemetria sempre, mesmo se o arquivo pedir para ligar', () => {
    expect(sanitizeSettings({ privacy: { telemetry: true } }).settings.privacy.telemetry).toBe(
      false,
    );
  });

  it('limita retenção de gravações a 10 anos', () => {
    expect(
      sanitizeSettings({ privacy: { retentionDays: 99999 } }).settings.privacy.retentionDays,
    ).toBe(3650);
    expect(
      sanitizeSettings({ privacy: { retentionDays: -1 } }).settings.privacy.retentionDays,
    ).toBe(0);
  });

  it('lixo total (string, número, null) vira o padrão', () => {
    for (const lixo of ['texto', 42, null, undefined, []]) {
      const { settings } = sanitizeSettings(lixo);
      expect(settings.mode).toBe(DEFAULT_SETTINGS.mode);
      expect(settings.audio).toEqual(DEFAULT_AUDIO);
      expect(settings.ui).toEqual(DEFAULT_UI);
    }
  });
});

describe('i18n', () => {
  const chaves = Object.keys(ptBR) as (keyof typeof ptBR)[];

  it('pt-BR e en têm exatamente as mesmas chaves', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ptBR).sort());
  });

  it('nenhuma tradução está vazia', () => {
    for (const dict of [ptBR, en]) {
      for (const [k, v] of Object.entries(dict)) {
        expect(typeof v, k).toBe('string');
        expect(v.trim().length, k).toBeGreaterThan(0);
      }
    }
  });

  it('toda chave devolve o texto exato do dicionário', () => {
    const t = translator('pt-BR');
    const te = translator('en');
    for (const k of chaves) {
      expect(t(k), k).toBe(ptBR[k]);
      expect(te(k), k).toBe(en[k]);
    }
  });

  // Invariante: hoje nenhuma string usa `{placeholder}`. Se alguém adicionar uma,
  // este teste falha e obriga a escrever o teste de interpolação que falta.
  it('nenhuma string usa placeholder; mesmo recebendo variáveis o texto não muda', () => {
    const t = translator('pt-BR');
    for (const k of chaves) {
      expect(ptBR[k], k).not.toMatch(/\{\w+\}/);
      expect(t(k, { nome: 'Ana', count: 7 }), k).toBe(ptBR[k]);
    }
  });

  it('localidade desconhecida cai no pt-BR', () => {
    const t = translator('de' as 'en');
    expect(t(chaves[0])).toBe(ptBR[chaves[0]]);
  });

  it('lista de idiomas disponíveis bate com os dicionários', () => {
    expect(AVAILABLE_LOCALES.map((l) => l.id).sort()).toEqual(['en', 'pt-BR']);
    for (const l of AVAILABLE_LOCALES) expect(l.label.length).toBeGreaterThan(3);
  });

  it('inglês é declarado parcial na interface, sem prometer o que não há', () => {
    expect(AVAILABLE_LOCALES.find((l) => l.id === 'en')?.label).toMatch(/partial/i);
  });
});
