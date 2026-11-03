/**
 * Espectrograma compacto (18 bandas log) — alternativa visual ao som,
 * útil para quem não pode ouvir o retorno.
 *
 * Implementação eficiente: as colunas são escritas num canvas offscreen de
 * 240×18 e depois escaladas para o tamanho real com `drawImage`. Isso mantém o
 * custo por quadro praticamente constante.
 *
 * A coluna nova é escrita direto nos bytes da imagem (1 `putImageData`), sem
 * `fillStyle`/`fillRect` por banda, e os rótulos de frequência ficam numa
 * camada estática — antes eram 18 strings de cor e 11 operações de texto por
 * quadro.
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

const COLS = 240;
const BANDS = 18;

/** Paleta perceptualmente ordenada (escuro → azul → branco → rosa). */
function colorFor(v: number, colorSafe: boolean): [number, number, number] {
  const t = Math.max(0, Math.min(1, v));
  if (colorSafe) {
    // violeta → ciano → âmbar
    if (t < 0.5) {
      const k = t / 0.5;
      return [40 + k * 30, 30 + k * 140, 90 + k * 120];
    }
    const k = (t - 0.5) / 0.5;
    return [70 + k * 180, 170 + k * 60, 210 - k * 130];
  }
  if (t < 0.45) {
    const k = t / 0.45;
    return [20 + k * 60, 28 + k * 130, 60 + k * 150];
  }
  if (t < 0.75) {
    const k = (t - 0.45) / 0.3;
    return [80 + k * 175, 158 + k * 80, 210 + k * 30];
  }
  const k = (t - 0.75) / 0.25;
  return [255, 238 - k * 60, 240 - k * 60];
}

export function Spectrogram({ buffer, reducedMotion, colorSafe = false }: Props) {
  const offRef = useRef<{
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    col: ImageData;
  } | null>(null);
  const lastT = useRef(0);
  /** último quadro já desenhado — evita repintar sem dado novo */
  const paintedT = useRef<number | null>(null);

  const paintChrome = useStaticLayer('spectrogram', (ctx, { width, height }) => {
    const labels = ['8k', '4k', '2k', '1k', '250'];
    ctx.font = '9.5px ui-monospace, monospace';
    labels.forEach((label, i) => {
      const y = 8 + (i / (labels.length - 1)) * (height - 20);
      ctx.fillStyle = 'rgba(8,11,18,0.55)';
      ctx.fillRect(0, y - 6, 34, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.62)';
      ctx.fillText(`${label} Hz`, 5, y + 3);
    });
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  });

  const { canvasRef } = useCanvas(
    (ctx, size) => {
      const { width, height } = size;
      if (!offRef.current) {
        const canvas = document.createElement('canvas');
        canvas.width = COLS;
        canvas.height = BANDS;
        const octx = canvas.getContext('2d');
        if (!octx) return;
        octx.fillStyle = 'rgb(10,13,20)';
        octx.fillRect(0, 0, COLS, BANDS);
        offRef.current = { canvas, ctx: octx, col: octx.createImageData(1, BANDS) };
      }
      const off = offRef.current;
      paintedT.current = buffer.latest?.t ?? 0;

      // desloca uma coluna por quadro novo (máx. 1 coluna por quadro renderizado)
      const latest = buffer.latest;
      if (latest && latest.t !== lastT.current) {
        lastT.current = latest.t;
        off.ctx.drawImage(off.canvas, -1, 0);
        const data = off.col.data;
        const bands = latest.bands ?? [];
        for (let b = 0; b < BANDS; b++) {
          const v = latest.voiced ? (bands[b] ?? 0) * (latest.f0Confidence * 0.4 + 0.6) : 0.08;
          const [r, g, bl] = colorFor(v, colorSafe);
          const p = (BANDS - 1 - b) * 4;
          data[p] = r;
          data[p + 1] = g;
          data[p + 2] = bl;
          data[p + 3] = 255;
        }
        off.ctx.putImageData(off.col, COLS - 1, 0);
      }

      ctx.clearRect(0, 0, width, height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off.canvas, 0, 0, width, height);

      // eixos de frequência + borda (camada estática)
      paintChrome(ctx, size);
    },
    {
      reducedMotion,
      aspect: 3.4 / 16,
      shouldPaint: () => (buffer.latest?.t ?? 0) !== paintedT.current,
    },
  );

  return (
    <canvas
      ref={canvasRef}
      className="hud-canvas"

      role="img"
      aria-label="Espectrograma de bandas: alternativa visual ao som em tempo real"
    />
  );
}
