#!/usr/bin/env node
/**
 * Gera `assets/dev/voz-sintetica.wav`: uma "voz" de teste com degraus de altura
 * e formantes de vogais, usada por `npm run screenshots` para alimentar o
 * microfone simulado do Chromium (`--use-file-for-fake-audio-capture`).
 *
 * Não é áudio de pessoa real: é um pulso glotal sintético filtrado por
 * ressonadores. Serve para verificar o pipeline (f0 estável em degraus,
 * harmônicos visíveis no espectrograma, formantes plausíveis).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(new URL('.', import.meta.url)));
const outPath = path.join(root, 'assets', 'dev', 'voz-sintetica.wav');

const FS = 48000;
const SEGMENTS = [
  {
    from: 0.0,
    to: 1.2,
    f0: 132,
    formants: [
      [700, 90],
      [1220, 110],
      [2600, 180],
    ],
  },
  {
    from: 1.2,
    to: 2.4,
    f0: 148,
    formants: [
      [500, 80],
      [1800, 110],
      [2500, 170],
    ],
  },
  {
    from: 2.4,
    to: 3.6,
    f0: 118,
    formants: [
      [730, 90],
      [1090, 90],
      [2440, 160],
    ],
  },
  {
    from: 3.6,
    to: 4.8,
    f0: 165,
    formants: [
      [400, 70],
      [2000, 120],
      [2600, 180],
    ],
  },
  {
    from: 4.8,
    to: 6.0,
    f0: 138,
    formants: [
      [660, 90],
      [1720, 110],
      [2410, 170],
    ],
  },
];

/** Ressonador de 2 polos (mesmo modelo usado no DSP do app para testes). */
function resonate(signal, freq, bw) {
  const r = Math.exp((-Math.PI * bw) / FS);
  const theta = (2 * Math.PI * freq) / FS;
  const a1 = -2 * r * Math.cos(theta);
  const a2 = r * r;
  const gain = (1 - r) * Math.sqrt(1 - 2 * r * Math.cos(2 * theta) + r * r);
  let y1 = 0;
  let y2 = 0;
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i += 1) {
    const y = gain * signal[i] - a1 * y1 - a2 * y2;
    out[i] = y;
    y2 = y1;
    y1 = y;
  }
  return out;
}

function build() {
  const total = Math.round(FS * 6);
  const out = new Float32Array(total);
  const fade = Math.round(0.03 * FS);

  for (const seg of SEGMENTS) {
    const start = Math.round(seg.from * FS);
    const end = Math.round(seg.to * FS);
    const len = end - start;
    const period = FS / seg.f0;

    // Pulso glotal: impulso a cada período, com jitter pequeno e determinístico.
    const pulses = new Float64Array(len);
    let phase = period;
    for (let i = 0; i < len; i += 1) {
      phase += 1;
      if (phase >= period) {
        phase = 0;
        pulses[i] = 1;
      }
    }
    // Radiação labial ≈ derivada do fluxo glotal.
    const radiated = new Float64Array(len);
    for (let i = 0; i < len; i += 1) {
      radiated[i] = pulses[i] - (i > 0 ? 0.95 * pulses[i - 1] : 0);
    }
    let sig = radiated;
    for (const [freq, bw] of seg.formants) sig = resonate(sig, freq, bw);

    let peak = 0;
    for (const v of sig) peak = Math.max(peak, Math.abs(v));
    const gain = peak > 0 ? 0.22 / peak : 0;
    for (let i = 0; i < len; i += 1) {
      let env = 1;
      if (i < fade) env = i / fade;
      else if (i > len - fade) env = (len - i) / fade;
      out[start + i] = sig[i] * gain * env;
    }
  }
  return out;
}

function encodeWav16(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buffer;
}

export function makeTestAudio(target = outPath) {
  mkdirSync(path.dirname(target), { recursive: true });
  const samples = build();
  writeFileSync(target, encodeWav16(samples, FS));
  return target;
}

if (process.argv[1] && process.argv[1].endsWith('make-test-audio.mjs')) {
  const written = makeTestAudio();
  console.log(
    `[make-test-audio] ${path.relative(root, written)} (${((FS * 6 * 2) / 1024).toFixed(0)} kB)`,
  );
}
