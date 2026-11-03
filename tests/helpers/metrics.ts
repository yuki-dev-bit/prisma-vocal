import type { LessonResult, SessionMetrics, VoiceProfile } from '../../src/shared/types';

export function makeMetrics(patch: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    durationSec: 6,
    voicedRatio: 0.7,
    f0MedianHz: 130,
    f0MeanHz: 132,
    f0P5Hz: 118,
    f0P95Hz: 146,
    f0MinHz: 112,
    f0MaxHz: 152,
    f0RangeSt: 3.5,
    f0SdSt: 0.6,
    f0Stability: 78,
    pitchDriftSt: null,
    levelMedianDb: -22,
    levelSdDb: 3,
    levelStability: 76,
    hnrMedianDb: 18,
    breathiness: 0.25,
    brightness: 0.6,
    resonanceIndex: 45,
    tiltDbPerOct: -12,
    formantF1Hz: 620,
    formantF2Hz: 1500,
    formantDispersionHz: 880,
    prosodySt: 5,
    clippingRatio: 0,
    registerBreaks: 0,
    frames: 300,
    qualityFlags: [],
    ...patch,
  };
}

export function makeProfile(patch: Partial<VoiceProfile> = {}): VoiceProfile {
  return {
    floorHz: 82,
    ceilingHz: 330,
    comfortableHz: 130,
    rangeSt: 24,
    rangeLabel: 'medio-grave',
    centerPosition: 40,
    registerMap: [],
    strengths: [],
    challenges: [],
    assessedAt: new Date().toISOString(),
    ...patch,
  };
}

export function makeLessonResult(patch: Partial<LessonResult> = {}): LessonResult {
  return {
    lessonId: 'fund-respiracao',
    exerciseId: 'fund-respiracao-ex1',
    completedAt: '2026-03-10T09:00:00.000Z',
    score: 80,
    metrics: makeMetrics(),
    targetsMet: [],
    feedbackIds: [],
    ...patch,
  };
}
