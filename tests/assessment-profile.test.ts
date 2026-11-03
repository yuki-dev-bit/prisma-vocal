import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_PROTOCOL,
  RANGE_LABEL_TEXT,
  buildProfile,
  describeRange,
  detectRegisterPoints,
  suggestGoals,
} from '@core/assessment/profile';
import type { AssessmentStepId, AssessmentStepResult } from '@shared/types';
import { makeMetrics, makeProfile } from './helpers/metrics';

const step = (stepId: AssessmentStepId, patch = {}): AssessmentStepResult => ({
  stepId,
  recordedAt: '2026-03-01T10:00:00.000Z',
  durationSec: 6,
  note: '',
  metrics: makeMetrics(patch),
  ...{},
});

describe('ASSESSMENT_PROTOCOL', () => {
  it('não pede nenhum valor absoluto de frequência nas etapas', () => {
    expect(ASSESSMENT_PROTOCOL.length).toBeGreaterThanOrEqual(5);
    for (const s of ASSESSMENT_PROTOCOL) {
      expect(s.instruction.length).toBeGreaterThan(10);
      expect(s.rationale.length).toBeGreaterThan(10);
      expect(s.durationSec).toBeGreaterThan(0);
      expect(['fala', 'sustentado', 'glissando', 'livre']).toContain(s.kind);
      expect(s.instruction).not.toMatch(/\d{3}\s*Hz/); // nada de "cante 220 Hz"
    }
  });

  it('não repete etapa', () => {
    const ids = ASSESSMENT_PROTOCOL.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('describeRange', () => {
  it('classifica pela altura confortável, sem prescrever', () => {
    expect(describeRange(null)).toBe('media');
    expect(describeRange(0)).toBe('media');
    expect(describeRange(100)).toBe('grave');
    expect(describeRange(120)).toBe('medio-grave');
    expect(describeRange(180)).toBe('media');
    expect(describeRange(230)).toBe('medio-aguda');
    expect(describeRange(300)).toBe('aguda');
  });

  it('todo rótulo tem texto legível', () => {
    for (const [k, v] of Object.entries(RANGE_LABEL_TEXT)) {
      expect(v.length).toBeGreaterThan(4);
      expect(k.length).toBeGreaterThan(2);
    }
  });
});

describe('detectRegisterPoints', () => {
  const frame = (t: number, f0: number | null, f0Confidence = 0.9) => ({ t, f0, f0Confidence });

  it('detecta salto grande de altura entre quadros vizinhos', () => {
    const pontos = detectRegisterPoints([frame(0, 200), frame(0.02, 400)]);
    expect(pontos).toHaveLength(1);
    expect(pontos[0].hz).toBe(400);
    expect(pontos[0].noteName).toBeTruthy();
  });

  it('ignora salto pequeno, quadro sem f0, baixa confiança e intervalo longo', () => {
    expect(detectRegisterPoints([frame(0, 200), frame(0.02, 210)])).toHaveLength(0);
    expect(detectRegisterPoints([frame(0, 200), frame(0.02, null)])).toHaveLength(0);
    expect(detectRegisterPoints([frame(0, 200, 0.3), frame(0.02, 400)])).toHaveLength(0);
    expect(detectRegisterPoints([frame(0, 200), frame(1.5, 400)])).toHaveLength(0);
  });

  it('agrupa pontos próximos em vez de repetir a mesma transição', () => {
    // dois trechos de glissando separados por uma pausa (o retorno a 200 Hz
    // fica longe demais no tempo e não conta como transição)
    const pontos = detectRegisterPoints([
      frame(0, 200),
      frame(0.02, 400),
      frame(0.5, 200),
      frame(0.52, 405),
    ]);
    expect(pontos).toHaveLength(1);
    expect(pontos[0].confidence).toBeCloseTo(0.65, 2);
  });

  it('devolve no máximo 4 pontos', () => {
    const frames = [] as { t: number; f0: number | null; f0Confidence: number }[];
    for (let i = 0; i < 8; i++) {
      frames.push(frame(i * 0.01, 150));
      frames.push(frame(i * 0.01 + 0.005, 150 * Math.pow(2, ((i + 1) * 8) / 12)));
    }
    expect(detectRegisterPoints(frames).length).toBeLessThanOrEqual(4);
  });
});

describe('buildProfile', () => {
  const completo = () => [
    step('fala-natural', { f0MedianHz: 130, prosodySt: 6 }),
    step('vogal-confortavel', { hnrMedianDb: 20, f0Stability: 80, levelStability: 80 }),
    step('glissando-descida', { f0P5Hz: 90 }),
    step('glissando-subida', { f0P95Hz: 300 }),
    step('ressonancia-escura', { resonanceIndex: 30 }),
    step('ressonancia-clara', { resonanceIndex: 60 }),
  ];

  it('monta piso, teto, centro e extensão a partir dos glissandos', () => {
    const { profile, notes } = buildProfile({ steps: completo(), mode: 'mtf' });
    expect(profile.floorHz).toBe(90);
    expect(profile.ceilingHz).toBe(300);
    expect(profile.comfortableHz).toBe(130);
    expect(profile.rangeSt).toBeCloseTo(20.8, 1);
    expect(profile.rangeLabel).toBe('medio-grave');
    expect(profile.centerPosition).toBeGreaterThan(0);
    expect(profile.centerPosition).toBeLessThan(100);
    expect(notes).toEqual([]);
  });

  it('reconhece pontos fortes e dificuldades sem virar diagnóstico', () => {
    const { profile } = buildProfile({ steps: completo(), mode: 'mtf' });
    expect(profile.strengths.join(' ')).toMatch(/pouco ar na voz/i);
    expect(profile.strengths.join(' ')).toMatch(/estabilidade de altura/i);
    expect(profile.strengths.join(' ')).toMatch(/alcance de timbre/i);
    expect(profile.challenges).toEqual([]);
    for (const texto of profile.strengths) expect(texto).not.toMatch(/diagnóstico/i);
  });

  it('sinaliza o que ficou fraco na avaliação', () => {
    const { profile } = buildProfile({
      steps: [
        step('vogal-confortavel', {
          hnrMedianDb: 8,
          f0Stability: 40,
          levelStability: 40,
        }),
        step('fala-natural', { prosodySt: 1.2, registerBreaks: 9 }),
        step('ressonancia-escura', { resonanceIndex: 40 }),
        step('ressonancia-clara', { resonanceIndex: 44 }),
      ],
      mode: 'mtf',
    });
    const texto = profile.challenges.join(' ');
    expect(texto).toMatch(/soprosidade/i);
    expect(texto).toMatch(/oscilou/i);
    expect(texto).toMatch(/volume/i);
    expect(texto).toMatch(/monótona/i);
    expect(texto).toMatch(/quebras de registro/i);
    expect(texto).toMatch(/ressonância/i);
  });

  it('sem glissandos avisa que a extensão não foi medida, sem inventar número', () => {
    const { profile, notes } = buildProfile({
      steps: [step('fala-natural', { f0P5Hz: 120, f0P95Hz: 180 })],
      mode: 'shared',
    });
    expect(profile.floorHz).toBeNull();
    expect(profile.ceilingHz).toBeNull();
    expect(profile.rangeSt).toBeCloseTo(7, 1); // cai na faixa da própria fala
    expect(notes.join(' ')).toMatch(/extensão vocal não pôde ser estimada/i);
    expect(notes.join(' ')).toMatch(/ressonância não concluídas/i);
  });

  it('extensão larga ganha rótulo próprio, não "voz aguda"', () => {
    const { profile } = buildProfile({
      steps: [
        step('glissando-descida', { f0P5Hz: 80 }),
        step('glissando-subida', { f0P95Hz: 520 }),
        step('fala-natural', { f0MedianHz: 200 }),
      ],
      mode: 'shared',
    });
    expect(profile.rangeSt).toBeGreaterThanOrEqual(30);
    expect(profile.rangeLabel).toBe('ampla');
  });

  it('anota ruído e clipping como ressalva de medição', () => {
    const { notes } = buildProfile({
      steps: [
        step('fala-natural', { qualityFlags: ['ruido-alto'] }),
        step('vogal-confortavel', { qualityFlags: ['clipping'] }),
      ],
      mode: 'shared',
    });
    expect(notes.join(' ')).toMatch(/ruído alto/i);
    expect(notes.join(' ')).toMatch(/clipping/i);
  });

  it('inclui o mapa de registro a partir dos quadros, limitado a 5', () => {
    const frames = (base: number) => [
      { t: 0, f0: base, f0Confidence: 0.9 },
      { t: 0.01, f0: base * 2, f0Confidence: 0.9 },
    ];
    const { profile } = buildProfile({
      steps: [],
      mode: 'shared',
      framesByStep: {
        'glissando-subida': frames(150),
        'glissando-descida': frames(220),
        'fala-natural': undefined,
      },
    });
    expect(profile.registerMap.length).toBeGreaterThan(0);
    expect(profile.registerMap.length).toBeLessThanOrEqual(5);
  });

  it('sem etapas não quebra: perfil vazio e centro neutro', () => {
    const { profile } = buildProfile({ steps: [], mode: 'shared' });
    expect(profile).toMatchObject({
      floorHz: null,
      ceilingHz: null,
      comfortableHz: null,
      rangeSt: 0,
      rangeLabel: 'media',
      centerPosition: 50,
      registerMap: [],
    });
    expect(typeof profile.assessedAt).toBe('string');
    expect(Number.isNaN(Date.parse(String(profile.assessedAt)))).toBe(false);
  });
});

describe('suggestGoals', () => {
  it('em mtf sugere subir 2 semitons e mais brilho, como sugestão', () => {
    const goals = suggestGoals(makeProfile({ comfortableHz: 130, rangeSt: 20 }), 'mtf');
    const centro = goals.find((g) => g.metric === 'f0MedianHz')!;
    expect(centro.target).toBe(Math.round(130 * Math.pow(2, 2 / 12)));
    expect(centro.relativeTo).toBe('baseline');
    expect(centro.rationale).toMatch(/não é um valor obrigatório/i);
    expect(goals.some((g) => g.metric === 'resonanceIndex')).toBe(true);
  });

  it('em ftm sugere descer 2 semitons e ganhar peso', () => {
    const goals = suggestGoals(makeProfile({ comfortableHz: 160 }), 'ftm');
    const centro = goals.find((g) => g.metric === 'f0MedianHz')!;
    expect(centro.target).toBe(Math.round(160 * Math.pow(2, -2 / 12)));
    expect(goals.some((g) => g.metric === 'hnrDb')).toBe(true);
  });

  it('sempre inclui estabilidade e não passa de 3 metas', () => {
    for (const mode of ['mtf', 'ftm', 'shared'] as const) {
      const goals = suggestGoals(makeProfile(), mode);
      expect(goals.some((g) => g.metric === 'f0Stability')).toBe(true);
      expect(goals.length).toBeLessThanOrEqual(3);
    }
  });

  it('sem altura confortável, não inventa meta de altura', () => {
    const goals = suggestGoals(makeProfile({ comfortableHz: null }), 'mtf');
    expect(goals.some((g) => g.metric === 'f0MedianHz')).toBe(false);
    expect(goals.length).toBeGreaterThan(0);
  });
});
