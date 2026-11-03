/**
 * AudioWorkletProcessor de captura.
 *
 * Roda na thread de áudio (tempo real): aplica ganho, portão de ruído e
 * mede pico/clipping. Envia blocos de 128 amostras (cópias) para a thread
 * principal, onde o analisador DSP consome. O áudio nunca sai da máquina.
 *
 * Mensagens aceitas:
 *   { type: 'config', gain, gateDb, monitoringVolume }
 *   { type: 'ping' }
 */
class PrismaCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.gain = 1;
    this.gateThreshold = 0.0008; // ≈ -62 dBFS
    this.gateEnabled = false;
    this.monitorVolume = 0;
    this.smoothedGain = 1;
    this.clipCount = 0;
    this.postEvery = 1;
    this.blockIndex = 0;

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'config') {
        if (typeof msg.gain === 'number' && Number.isFinite(msg.gain)) {
          this.gain = Math.min(8, Math.max(0, msg.gain));
        }
        if (typeof msg.gateDb === 'number' && Number.isFinite(msg.gateDb)) {
          // -80..-30 dBFS → linear
          this.gateThreshold = Math.pow(10, Math.min(-30, Math.max(-80, msg.gateDb)) / 20);
        }
        if (typeof msg.gateEnabled === 'boolean') this.gateEnabled = msg.gateEnabled;
        if (typeof msg.monitorVolume === 'number' && Number.isFinite(msg.monitorVolume)) {
          this.monitorVolume = Math.min(1, Math.max(0, msg.monitorVolume));
        }
      } else if (msg.type === 'ping') {
        this.port.postMessage({ type: 'pong' });
      }
    };
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) {
      return true; // mantém o processador vivo enquanto não há entrada
    }

    const channel = input[0];
    const n = channel.length;
    const processed = new Float32Array(n);

    // suaviza mudanças de ganho (evita "degraus" audíveis)
    this.smoothedGain += (this.gain - this.smoothedGain) * 0.02;

    let peak = 0;
    let clipped = 0;
    let sumSq = 0;

    for (let i = 0; i < n; i++) {
      let s = channel[i] * this.smoothedGain;
      if (s > 1 || s < -1) {
        clipped++;
        s = s > 1 ? 1 : -1;
      }
      if (this.gateEnabled && Math.abs(s) < this.gateThreshold) s *= 0.08;
      processed[i] = s;
      const abs = s < 0 ? -s : s;
      if (abs > peak) peak = abs;
      sumSq += s * s;
    }

    if (output && output.length > 0) {
      const out = output[0];
      const vol = this.monitorVolume;
      for (let i = 0; i < n; i++) out[i] = processed[i] * vol;
      for (let c = 1; c < output.length; c++) output[c].fill(0);
    }

    this.clipCount += clipped;
    this.blockIndex++;

    // envia a cada bloco (128 amostras ≈ 2,7 ms @ 48 kHz)
    if (this.blockIndex % this.postEvery === 0) {
      this.port.postMessage(
        {
          type: 'block',
          samples: processed,
          peak,
          rms: Math.sqrt(sumSq / n),
          clipped,
        },
        [processed.buffer],
      );
    }
    return true;
  }
}

registerProcessor('prisma-capture', PrismaCaptureProcessor);
