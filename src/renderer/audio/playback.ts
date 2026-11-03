/** Reprodução de PCM float32 (gravações decodificadas) com controle de parada. */

let ctx: AudioContext | null = null;
let current: { source: AudioBufferSourceNode; ctx: AudioContext } | null = null;

function getContext(): AudioContext {
  if (!ctx || ctx.state === 'closed') {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor({ latencyHint: 'interactive' });
  }
  return ctx;
}

export async function playPcm(
  pcm: Float32Array,
  sampleRate: number,
  onEnded?: () => void,
  volume = 0.9,
): Promise<void> {
  stopPlayback();
  if (pcm.length === 0) return;
  const context = getContext();
  if (context.state === 'suspended') await context.resume();
  const buffer = context.createBuffer(1, pcm.length, Math.max(8000, sampleRate || 48000));
  buffer.getChannelData(0).set(pcm);
  const source = context.createBufferSource();
  source.buffer = buffer;
  const gain = context.createGain();
  gain.gain.value = Math.max(0, Math.min(1, volume));
  source.connect(gain).connect(context.destination);
  source.onended = () => {
    if (current?.source === source) current = null;
    onEnded?.();
  };
  source.start();
  current = { source, ctx: context };
}

export function stopPlayback(): void {
  if (current) {
    try {
      current.source.stop();
    } catch {
      /* já parado */
    }
    current = null;
  }
}

export function isPlaying(): boolean {
  return current !== null;
}
