import { describe, expect, it } from 'vitest';
import { decodeWav, encodeWav16, toMono } from '@core/dsp/wav';

const tone = (n: number, freq = 220, rate = 48000) => {
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.sin((2 * Math.PI * freq * i) / rate) * 0.5;
  return s;
};

const wav24 = (samples: Float32Array, sampleRate = 8000): Uint8Array => {
  const dataSize = samples.length * 3;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const tag = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  tag(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 3, true);
  v.setUint16(32, 3, true);
  v.setUint16(34, 24, true);
  tag(36, 'data');
  v.setUint32(40, dataSize, true);
  for (let i = 0; i < samples.length; i++) {
    let v24 = Math.round(samples[i] * 0x7fffff);
    if (v24 < 0) v24 += 0x1000000;
    v.setUint8(44 + i * 3, v24 & 0xff);
    v.setUint8(45 + i * 3, (v24 >> 8) & 0xff);
    v.setUint8(46 + i * 3, (v24 >> 16) & 0xff);
  }
  return new Uint8Array(buf);
};

describe('encodeWav16', () => {
  it('escreve um cabeçalho RIFF/WAVE coerente com o tamanho', () => {
    const bytes = encodeWav16(tone(10), 48000);
    expect(bytes.length).toBe(44 + 20);
    const v = new DataView(bytes.buffer);
    const tag = (o: number) => String.fromCharCode(...bytes.slice(o, o + 4));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(v.getUint32(4, true)).toBe(36 + 20);
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint32(28, true)).toBe(48000 * 2); // byte rate
    expect(v.getUint16(32, true)).toBe(2); // block align
    expect(v.getUint16(34, true)).toBe(16);
    expect(tag(36)).toBe('data');
    expect(v.getUint32(40, true)).toBe(20);
  });

  it('grava o nº de canais informado no cabeçalho e no byte rate', () => {
    const bytes = encodeWav16(tone(12), 44100, 2);
    const v = new DataView(bytes.buffer);
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(28, true)).toBe(44100 * 2 * 2);
    expect(v.getUint16(32, true)).toBe(4);
  });

  it('satura acima de ±1 em vez de estourar o inteiro de 16 bits', () => {
    const bytes = encodeWav16(new Float32Array([2, -2]), 8000);
    const v = new DataView(bytes.buffer);
    expect(v.getInt16(44, true)).toBe(0x7fff);
    expect(v.getInt16(46, true)).toBe(-0x8000);
  });

  it('ida e volta preserva o sinal dentro do erro de quantização', () => {
    const original = tone(256);
    const { samples, sampleRate, channels } = decodeWav(encodeWav16(original, 48000));
    expect(sampleRate).toBe(48000);
    expect(channels).toBe(1);
    expect(samples.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      // erro máximo de meio passo de quantização (16 bits)
      expect(Math.abs(samples[i] - original[i])).toBeLessThanOrEqual(1 / 32768);
    }
  });
});

describe('decodeWav', () => {
  it('lê WAV 24 bits com sinal correto', () => {
    const original = new Float32Array([0, 0.5, -0.5, 0.25]);
    const { samples, sampleRate } = decodeWav(wav24(original, 8000));
    expect(sampleRate).toBe(8000);
    for (let i = 0; i < original.length; i++) {
      expect(samples[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('recusa arquivo que não é WAV', () => {
    const bytes = new Uint8Array(44);
    bytes.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
    expect(() => decodeWav(bytes)).toThrow(/não é um WAV válido/);
  });

  it('recusa WAV truncado antes do chunk de dados', () => {
    const completo = encodeWav16(tone(8), 48000);
    expect(() => decodeWav(completo.slice(0, 30))).toThrow(/sem chunk fmt\/data/);
  });

  it('recusa formato sem suporte (ex.: 8 bits)', () => {
    const bytes = encodeWav16(tone(4), 8000);
    const v = new DataView(bytes.buffer);
    v.setUint16(34, 8, true);
    expect(() => decodeWav(bytes)).toThrow(/Formato WAV não suportado/);
  });

  it('não lê além do buffer quando o cabeçalho infla o tamanho', () => {
    const bytes = encodeWav16(tone(8), 8000);
    const v = new DataView(bytes.buffer);
    v.setUint32(40, 999999, true); // data size mentiroso
    const { samples } = decodeWav(bytes);
    expect(samples.length).toBe(8);
  });
});

describe('toMono', () => {
  it('devolve o próprio buffer quando já é mono', () => {
    const samples = tone(16);
    expect(toMono({ sampleRate: 48000, channels: 1, samples })).toBe(samples);
  });

  it('faz a média dos canais quadro a quadro', () => {
    const samples = new Float32Array([1, -1, 0.5, 0.5, 0.2, 0.4]);
    const mono = toMono({ sampleRate: 48000, channels: 2, samples });
    expect(Array.from(mono)).toEqual([0, 0.5, 0.30000001192092896]);
  });

  it('ignora amostra sobrando de um quadro incompleto', () => {
    const samples = new Float32Array([1, 1, 0.5]);
    expect(toMono({ sampleRate: 48000, channels: 2, samples }).length).toBe(1);
  });
});

describe('decodeWav — chunks extras', () => {
  /**
   * Arquivos gerados por outros programas trazem chunks antes de `data`
   * (LIST, fact…). O decodificador precisa pular todos e achar fmt/data.
   */
  const wavComChunks = (samples: Float32Array, sampleRate = 8000): Uint8Array => {
    const base = encodeWav16(samples, sampleRate);
    type Chunk = { id: string; body: Uint8Array };
    const listBody = new Uint8Array(5); // tamanho ímpar de propósito
    listBody.set([0x49, 0x4e, 0x46, 0x4f, 0x00], 0);
    const chunks: Chunk[] = [
      { id: 'LIST', body: listBody },
      // fmt copiado do WAV original (bytes 12..36)
      { id: 'fmt ', body: base.slice(20, 36) },
      { id: 'JUNK', body: new Uint8Array(0) },
      { id: 'data', body: base.slice(44) },
    ];
    const total = chunks.reduce((a, c) => a + 8 + c.body.length + (c.body.length % 2), 12);
    const out = new Uint8Array(total);
    const v = new DataView(out.buffer);
    const tag = (o: number, s: string) => {
      for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i);
    };
    tag(0, 'RIFF');
    v.setUint32(4, total - 8, true);
    tag(8, 'WAVE');
    let pos = 12;
    for (const c of chunks) {
      tag(pos, c.id);
      v.setUint32(pos + 4, c.body.length, true);
      out.set(c.body, pos + 8);
      pos += 8 + c.body.length + (c.body.length % 2);
    }
    return out;
  };

  it('pula LIST/JUNK, inclusive com tamanho ímpar (padding)', () => {
    const original = tone(16);
    const { samples, sampleRate } = decodeWav(wavComChunks(original, 8000));
    expect(sampleRate).toBe(8000);
    expect(samples.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(samples[i]).toBeCloseTo(original[i], 4);
    }
  });

  it('aceita data antes de fmt (ordem livre de chunks)', () => {
    const original = tone(8);
    const base = encodeWav16(original, 8000);
    const dataFirst = new Uint8Array(base.length);
    const v = new DataView(dataFirst.buffer);
    const tag = (o: number, s: string) => {
      for (let i = 0; i < 4; i++) dataFirst[o + i] = s.charCodeAt(i);
    };
    tag(0, 'RIFF');
    v.setUint32(4, base.length - 8, true);
    tag(8, 'WAVE');
    tag(12, 'data');
    v.setUint32(16, 16, true);
    dataFirst.set(base.slice(44), 20);
    tag(36, 'fmt ');
    v.setUint32(40, 16, true);
    dataFirst.set(base.slice(20, 36), 44);

    const { samples } = decodeWav(dataFirst);
    expect(samples.length).toBe(original.length);
  });
});
