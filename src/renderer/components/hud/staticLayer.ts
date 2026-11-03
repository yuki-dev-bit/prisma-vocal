/**
 * Camada estática de um canvas: grade, rótulos e bordas que não mudam de um
 * quadro para o outro.
 *
 * No HUD, três gráficos redesenhavam o mesmo chrome 60 vezes por segundo —
 * cada `fillText` é caro no WebView do Android. Aqui o chrome é desenhado uma
 * vez num canvas fora de tela e por quadro só se copia o resultado
 * (`drawImage`).
 *
 * `key` deve conter tudo que afeta o desenho além do tamanho (largura, faixa
 * de frequência, paleta, presença de dado…). Tamanho e DPR sempre invalidam.
 */
import { useRef } from 'react';
import type { CanvasSize } from './useCanvas';

interface Layer {
  canvas: HTMLCanvasElement;
  key: string;
}

export function useStaticLayer(
  key: string,
  paint: (ctx: CanvasRenderingContext2D, size: CanvasSize) => void,
): (ctx: CanvasRenderingContext2D, size: CanvasSize) => void {
  const layerRef = useRef<Layer | null>(null);
  const paintRef = useRef(paint);
  paintRef.current = paint;

  return (ctx, size) => {
    const fullKey = `${key}|${size.width}x${size.height}@${size.dpr}`;
    let layer = layerRef.current;
    if (!layer || layer.key !== fullKey) {
      const canvas = layer?.canvas ?? document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(size.width * size.dpr));
      canvas.height = Math.max(1, Math.floor(size.height * size.dpr));
      const lctx = canvas.getContext('2d');
      if (!lctx) return;
      lctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
      lctx.clearRect(0, 0, size.width, size.height);
      paintRef.current(lctx, size);
      layer = { canvas, key: fullKey };
      layerRef.current = layer;
    }
    // a camada está em pixels do dispositivo: copia sem a escala do ctx
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
  };
}
