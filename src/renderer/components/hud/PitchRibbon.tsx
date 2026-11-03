/**
 * "Fita de altura": o gráfico principal do HUD.
 *
 * Mostra f0 no tempo em escala logarítmica, com:
 *  • linhas de nota (Dó) como referência musical estável;
 *  • faixa-alvo do exercício (se houver);
 *  • rastro com opacidade proporcional à confiança do detector;
 *  • marcador da nota atual com nome (ex.: A3).
 *
 * Custo por quadro: a "moldura" (fundo, faixa-alvo, linhas de nota, eixo de
 * tempo) fica numa camada estática, o gradiente é criado uma vez por tamanho e
 * o rastro é escrito em buffers reaproveitados — antes cada quadro alocava um
 * gradiente e um objeto por amostra.
 */
import { useRef } from 'react';
import { RING_SIZE, type LiveBuffer } from '../../state/useLiveSession';
import { hzToSemitones, noteName } from '../../../core/utils/math';
import { useCanvas } from './useCanvas';
import { useStaticLayer } from './staticLayer';

interface Props {
  buffer: LiveBuffer;
  minHz: number;
  maxHz: number;
  targetHz?: number | null;
  targetBand?: { minHz: number; maxHz: number } | null;
  reducedMotion?: boolean;
  colorSafe?: boolean;
  height?: number;
}

const TIME_SPAN = 12; // segundos visíveis
const PAD_L = 44;
const PAD_R = 12;
const PAD_T = 14;
const PAD_B = 18;

export function PitchRibbon({
  buffer,
  minHz,
  maxHz,
  targetHz,
  targetBand,
  reducedMotion,
  colorSafe,
}: Props) {
  const trailRef = useRef({ x: new Float32Array(RING_SIZE), y: new Float32Array(RING_SIZE) });
  /** último quadro já desenhado — evita repintar sem dado novo */
  const paintedT = useRef<number | null>(null);
  const accent = colorSafe ? '#7fb8ff' : '#5bcefa';
  const accent2 = colorSafe ? '#ffb35c' : '#f5a9b8';

  const bandKey = targetBand ? `${targetBand.minHz}-${targetBand.maxHz}` : 'none';
  const paintChrome = useStaticLayer(
    `pitch|${minHz}|${maxHz}|${bandKey}|${colorSafe}`,
    (ctx, { width, height }) => {
      const plotW = width - PAD_L - PAD_R;
      const plotH = height - PAD_T - PAD_B;
      const lo = Math.log2(minHz);
      const hi = Math.log2(maxHz);
      const yFor = (hz: number) => PAD_T + plotH - ((Math.log2(hz) - lo) / (hi - lo)) * plotH;

      // fundo
      const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + plotH);
      grad.addColorStop(0, 'rgba(91,206,250,0.055)');
      grad.addColorStop(0.55, 'rgba(255,255,255,0.012)');
      grad.addColorStop(1, 'rgba(245,169,184,0.05)');
      ctx.fillStyle = grad;
      ctx.fillRect(PAD_L, PAD_T, plotW, plotH);

      // faixa-alvo
      if (targetBand && targetBand.maxHz > targetBand.minHz) {
        const y1 = yFor(Math.min(targetBand.maxHz, maxHz));
        const y2 = yFor(Math.max(targetBand.minHz, minHz));
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        ctx.fillRect(PAD_L, y1, plotW, y2 - y1);
        ctx.strokeStyle = 'rgba(255,255,255,0.20)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD_L, y1);
        ctx.lineTo(PAD_L + plotW, y1);
        ctx.moveTo(PAD_L, y2);
        ctx.lineTo(PAD_L + plotW, y2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // linhas de nota (Dó, Sol; ou todas se o zoom for grande)
      const stLo = hzToSemitones(minHz);
      const stHi = hzToSemitones(maxHz);
      const span = stHi - stLo;
      const step = span > 30 ? 12 : span > 16 ? 7 : span > 8 ? 4 : 2;
      ctx.font = '10px ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      for (let st = Math.ceil(stLo / step) * step; st <= stHi; st += step) {
        const hz = 130.8127826502993 * Math.pow(2, st / 12);
        const y = yFor(hz);
        const isOctave = Math.round(st) % 12 === 0;
        ctx.strokeStyle = isOctave ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD_L, y);
        ctx.lineTo(PAD_L + plotW, y);
        ctx.stroke();
        if (isOctave) {
          ctx.fillStyle = 'rgba(255,255,255,0.34)';
          ctx.fillText(noteName(hz), 6, y);
        }
      }

      // eixo de tempo
      ctx.fillStyle = 'rgba(255,255,255,0.26)';
      for (let s = 0; s <= TIME_SPAN; s += 3) {
        const x = PAD_L + plotW - (s / TIME_SPAN) * plotW;
        ctx.fillRect(x, PAD_T + plotH, 1, 4);
        if (s > 0) ctx.fillText(`-${s}s`, x + 3, PAD_T + plotH + 11);
      }
    },
  );

  const { canvasRef } = useCanvas(
    (ctx, size) => {
      const { width, height } = size;
      const plotW = width - PAD_L - PAD_R;
      const plotH = height - PAD_T - PAD_B;
      const lo = Math.log2(minHz);
      const hi = Math.log2(maxHz);
      const yFor = (hz: number) => PAD_T + plotH - ((Math.log2(hz) - lo) / (hi - lo)) * plotH;
      const xFor = (t: number, now: number) => PAD_L + plotW - ((now - t) / TIME_SPAN) * plotW;

      ctx.clearRect(0, 0, width, height);
      paintChrome(ctx, size);
      paintedT.current = buffer.latest?.t ?? 0;

      // rastro (buffers reaproveitados, sem alocar por amostra)
      const trail = trailRef.current;
      const now = buffer.latest?.t ?? 0;
      let count = 0;
      buffer.forEach((f) => {
        if (!f.voiced || !f.f0 || count >= trail.x.length) return;
        const x = xFor(f.t, now);
        if (x < PAD_L - 2) return;
        trail.x[count] = x;
        trail.y[count] = yFor(Math.min(maxHz, Math.max(minHz, f.f0)));
        count++;
      });

      if (count > 1) {
        // sombra/brilho
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (const pass of [
          { width: 7, alpha: 0.13, color: accent },
          { width: 2.2, alpha: 0.95, color: accent },
        ]) {
          ctx.strokeStyle = pass.color;
          ctx.globalAlpha = pass.alpha;
          ctx.lineWidth = pass.width;
          ctx.beginPath();
          let started = false;
          let lastX = -Infinity;
          for (let i = 0; i < count; i++) {
            const x = trail.x[i];
            const y = trail.y[i];
            if (!started || x - lastX > plotW / 24) {
              ctx.moveTo(x, y);
              started = true;
            } else {
              ctx.lineTo(x, y);
            }
            lastX = x;
          }
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        const lastX = trail.x[count - 1];
        const lastY = trail.y[count - 1];
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(lastX, lastY, 3.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 7.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // alvo (nota de referência)
      if (targetHz && targetHz >= minHz && targetHz <= maxHz) {
        const y = yFor(targetHz);
        ctx.strokeStyle = accent2;
        ctx.globalAlpha = 0.65;
        ctx.setLineDash([2, 5]);
        ctx.beginPath();
        ctx.moveTo(PAD_L, y);
        ctx.lineTo(PAD_L + plotW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }

      // rótulo da nota atual
      const latest = buffer.latest;
      if (latest?.f0) {
        const y = yFor(Math.min(maxHz, Math.max(minHz, latest.f0)));
        const label = noteName(latest.f0);
        ctx.font = '600 11px ui-monospace, monospace';
        const w = ctx.measureText(label).width + 12;
        ctx.fillStyle = 'rgba(8,11,18,0.85)';
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1;
        const bx = PAD_L + plotW - w - 2;
        ctx.beginPath();
        ctx.roundRect(bx, y - 9, w, 18, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, bx + 6, y + 0.5);
      }

      // borda
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD_L + 0.5, PAD_T + 0.5, plotW - 1, plotH - 1);
    },
    {
      reducedMotion,
      aspect: 5.2 / 16,
      shouldPaint: () => (buffer.latest?.t ?? 0) !== paintedT.current,
    },
  );

  return (
    <canvas
      ref={canvasRef}
      className="hud-canvas"
      aria-label="Gráfico de altura (f0) no tempo"
      role="img"
    />
  );
}
