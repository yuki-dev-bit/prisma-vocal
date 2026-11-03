/**
 * Codificação/decodificação WAV (PCM 16 bits, PCM 24 bits e float32).
 * Usada para exportar gravações e para testes/importação de amostras.
 */

export interface WavData {
  sampleRate: number;
  channels: number;
  samples: Float32Array; // intercalado se channels > 1
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

/** Codifica PCM float32 (-1..1) em WAV de 16 bits. */
export function encodeWav16(samples: Float32Array, sampleRate: number, channels = 1): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    // Escala simétrica (0x8000 nos dois sinais) e saturação em +0x7fff:
    // usar 0x7fff nos positivos introduzia um ganho 0,003% menor na volta.
    const q = Math.round(s * 0x8000);
    view.setInt16(offset, Math.max(-0x8000, Math.min(0x7fff, q)), true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

export function decodeWav(bytes: Uint8Array): WavData {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) =>
    String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Arquivo não é um WAV válido');

  let pos = 12;
  let fmt: { format: number; channels: number; sampleRate: number; bits: number } | null = null;
  let dataOffset = -1;
  let dataLength = 0;

  while (pos + 8 <= bytes.length) {
    const id = tag(pos);
    const size = view.getUint32(pos + 4, true);
    const body = pos + 8;
    if (id === 'fmt ') {
      if (body + 16 > bytes.length) break; // chunk fmt truncado
      fmt = {
        format: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    } else if (id === 'data') {
      dataOffset = body;
      dataLength = Math.min(size, bytes.length - body);
      if (fmt) break;
    }
    pos = body + size + (size % 2);
  }
  if (!fmt || dataOffset < 0) throw new Error('WAV sem chunk fmt/data');

  const { format, channels, sampleRate, bits } = fmt;
  const bytesPerSample = bits / 8;
  const count = Math.floor(dataLength / bytesPerSample);
  const samples = new Float32Array(count);

  if (format === 3 && bits === 32) {
    for (let i = 0; i < count; i++) samples[i] = view.getFloat32(dataOffset + i * 4, true);
  } else if (format === 1 && bits === 16) {
    for (let i = 0; i < count; i++) samples[i] = view.getInt16(dataOffset + i * 2, true) / 0x8000;
  } else if (format === 1 && bits === 24) {
    for (let i = 0; i < count; i++) {
      const o = dataOffset + i * 3;
      let v = bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16);
      if (v & 0x800000) v |= ~0xffffff;
      samples[i] = v / 0x800000;
    }
  } else if (format === 1 && bits === 32) {
    for (let i = 0; i < count; i++)
      samples[i] = view.getInt32(dataOffset + i * 4, true) / 0x80000000;
  } else {
    throw new Error(`Formato WAV não suportado: format=${format} bits=${bits}`);
  }
  return { sampleRate, channels, samples };
}

/** Converte para mono (média dos canais). */
export function toMono(data: WavData): Float32Array {
  if (data.channels === 1) return data.samples;
  const frames = Math.floor(data.samples.length / data.channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < data.channels; c++) acc += data.samples[i * data.channels + c];
    out[i] = acc / data.channels;
  }
  return out;
}
