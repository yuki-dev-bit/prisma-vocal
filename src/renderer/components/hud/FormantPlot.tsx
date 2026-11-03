/**
 * Plano F1×F2: mostra onde a voz está no "espaço de vogais".
 * É uma visualização de estimativas (LPC) — não um mapa exato do trato vocal.
 *
 * Custo por quadro: a grade e os rótulos ficam numa camada estática e a trilha
 * é desenhada em ~16 traços (um por faixa de opacidade) em vez de um traço por
 * segmento — antes eram até 900 `stroke()` e 900 strings de cor por quadro.
 */
import { useRef } from 'react';
import type { LiveBuffer } from '../../state/useLiveSession';
import { useCanvas } from './useCanvas';
import { useStaticLayer } from './staticLayer';

interface Props {
  buffer: LiveBuffer;
  reducedMotion?: boolean;
  colorSafe?: boolean;
}

const PAD = 26;
/** Faixas de opacidade da trilha (a idade vira 1 de 16 tons, não 900). */
const ALPHA_STEPS = 16;

export function FormantPlot({ buffer, reducedMotion, colorSafe = false }: Props) {
  // segmentos agrupados por faixa: [x1, y1, x2, y2, ...]
  const segsRef = useRef<number[][]>(Array.from({ length: ALPHA_STEPS }, () => [] as number[]));
  /** último quadro já desenhado — evita repintar sem dado novo */
  const paintedT = useRef<number | null>(null);
  const trailColor = colorSafe ? '127,184,255' : '91,206,250';
  const dotColor = colorSafe ? '#ffb35c' : '#f5a9b8';

  const paintChrome = useStaticLayer(`formants|${colorSafe}`, (ctx, { width, height }) => {
    const pad = PAD;
    const plotW = width - pad * 2;
    const plotH = height - pad * 2;

    // eixos: F1 200–1100 Hz, F2 600–3200 Hz (invertido no eixo X: vogais
    // frontais ficam à direita, como nos gráficos tradicionais)
    const xFor = (f2: number) => pad + plotW * (1 - (f2 - 600) / (3200 - 600));
    const yFor = (f1: number) => pad + plotH * ((f1 - 200) / (1100 - 200));

    ctx.fillStyle = 'rgba(255,255,255,0.014)';
    ctx.fillRect(pad, pad, plotW, plotH);

    // grade + rótulos
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '9.5px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (let f1 = 300; f1 <= 1000; f1 += 200) {
      const y = yFor(f1);
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(pad + plotW, y);
      ctx.stroke();
      ctx.fillText(`${f1}`, 4, y + 3);
    }
    for (let f2 = 800; f2 <= 3000; f2 += 400) {
      const x = xFor(f2);
      ctx.beginPath();
      ctx.moveTo(x, pad);
      ctx.lineTo(x, pad + plotH);
      ctx.stroke();
      ctx.fillText(`${f2}`, x - 8, pad + plotH + 14);
    }
    // títulos dos eixos na linha de cima: no rodapé o "F2 (Hz) →" encostava no
    // rótulo do último tick (1200)
    ctx.fillStyle = 'rgba(255,255,255,0.36)';
    ctx.fillText('F1 (Hz) ↑', pad + 2, pad - 8);
    ctx.textAlign = 'right';
    ctx.fillText('F2 (Hz) →', pad + plotW, pad - 8);
    ctx.textAlign = 'left';
  });

  const { canvasRef } = useCanvas(
    (ctx, size) => {
      const { width, height } = size;
      const pad = PAD;
      const plotW = width - pad * 2;
      const plotH = height - pad * 2;
      const xFor = (f2: number) => pad + plotW * (1 - (f2 - 600) / (3200 - 600));
      const yFor = (f1: number) => pad + plotH * ((f1 - 200) / (1100 - 200));

      ctx.clearRect(0, 0, width, height);
      paintChrome(ctx, size);
      paintedT.current = buffer.latest?.t ?? 0;

      // trilha recente de F1/F2 — uma passada, sem alocar objeto por quadro
      const segs = segsRef.current;
      for (const seg of segs) seg.length = 0;
      const total = buffer.count;
      let prevX = NaN;
      let prevY = NaN;
      let lastX = 0;
      let lastY = 0;
      let valid = 0;
      buffer.forEach((f, i) => {
        const fmt = f.formants;
        if (!fmt || !f.voiced) return;
        const f1v = fmt[0];
        const f2v = fmt[1];
        if (!f1v || !f2v) return;
        if (f1v < 180 || f1v > 1150 || f2v < 550 || f2v > 3300) return;
        const x = xFor(f2v);
        const y = yFor(f1v);
        if (valid > 0) {
          const age = total > 0 ? i / total : 0;
          const step = Math.min(ALPHA_STEPS - 1, Math.floor(age * ALPHA_STEPS));
          segs[step].push(prevX, prevY, x, y);
        }
        prevX = x;
        prevY = y;
        lastX = x;
        lastY = y;
        valid++;
      });

      if (valid > 1) {
        ctx.lineWidth = 1.6;
        for (let step = 0; step < ALPHA_STEPS; step++) {
          const seg = segs[step];
          if (!seg.length) continue;
          const alpha = 0.1 + ((step + 0.5) / ALPHA_STEPS) * 0.75;
          ctx.strokeStyle = `rgba(${trailColor},${alpha.toFixed(3)})`;
          ctx.beginPath();
          for (let k = 0; k < seg.length; k += 4) {
            ctx.moveTo(seg[k], seg[k + 1]);
            ctx.lineTo(seg[k + 2], seg[k + 3]);
          }
          ctx.stroke();
        }
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.65)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(lastX, lastY, 7, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.28)';
        ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
        ctx.fillText('Sustente uma vogal para estimar F1/F2', pad + 10, pad + plotH / 2);
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.strokeRect(pad + 0.5, pad + 0.5, plotW - 1, plotH - 1);
    },
    {
      reducedMotion,
      aspect: 9 / 16,
      shouldPaint: () => (buffer.latest?.t ?? 0) !== paintedT.current,
    },
  );

  return (
    <canvas
      ref={canvasRef}
      className="hud-canvas"
      role="img"
      aria-label="Plano de formantes F1 por F2 (estimativa)"
    />
  );
}
