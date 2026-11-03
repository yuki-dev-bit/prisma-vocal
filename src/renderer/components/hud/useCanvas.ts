/**
 * Hook de canvas: resolução correta (DPR), proporção explícita e loop de
 * animação que se pausa quando não há ninguém olhando.
 *
 * Decisões que existem por causa de celular:
 *  • a proporção vem de `aspect` (não de ler `canvas.height / canvas.width`,
 *    que dependia do buffer anterior e produzia alturas arbitrárias);
 *  • o DPR é limitado a 2 — em telas 3x, o custo de 9x mais pixels não paga;
 *  • o loop para com a aba em segundo plano (`document.hidden`) e com o canvas
 *    fora da viewport (IntersectionObserver): menos bateria e menos CPU;
 *  • `prefers-reduced-motion` reduz a ~12 fps;
 *  • `shouldPaint` evita pintar quando o componente não tem dado novo — com a
 *    sessão parada o gráfico custa zero em vez de 60 desenhos por segundo;
 *  • um re-render do React (paleta, alvo, faixa…) conta como dado novo, então
 *    `shouldPaint` nunca deixa a imagem antiga presa na tela.
 */
import { useEffect, useRef } from 'react';

export interface CanvasSize {
  width: number;
  height: number;
  dpr: number;
}

const MAX_DPR = 2;

export interface CanvasOptions {
  animate?: boolean;
  reducedMotion?: boolean;
  aspect?: number;
  /** Devolve `false` quando não há nada novo para desenhar neste quadro. */
  shouldPaint?: () => boolean;
}

export function useCanvas(
  draw: (ctx: CanvasRenderingContext2D, size: CanvasSize) => void,
  opts: CanvasOptions = {},
) {
  const { animate = true, reducedMotion = false, aspect = 0.32 } = opts;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef<CanvasSize>({ width: 0, height: 0, dpr: 1 });
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const shouldPaintRef = useRef(opts.shouldPaint);
  shouldPaintRef.current = opts.shouldPaint;
  const renderCount = useRef(0);
  const paintedRender = useRef(0);
  renderCount.current += 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;

    let visible = true;
    let raf = 0;
    let last = 0;
    const minDelta = reducedMotion ? 84 : 0;

    const paint = () => {
      const ctx = canvas.getContext('2d');
      if (ctx && sizeRef.current.width > 0) drawRef.current(ctx, sizeRef.current);
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      const rect = parent.getBoundingClientRect();
      const width = Math.max(160, Math.floor(rect.width));
      const height = Math.max(90, Math.round(width * aspect));
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      sizeRef.current = { width, height, dpr };
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        paint();
      }
    };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden) return;
      if (minDelta && t - last < minDelta) return;
      const needsPaint = shouldPaintRef.current;
      const staleRender = paintedRender.current !== renderCount.current;
      if (needsPaint && !needsPaint() && !staleRender) return;
      paintedRender.current = renderCount.current;
      last = t;
      paint();
    };

    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    resize();

    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entries) => {
            visible = entries.some((e) => e.isIntersecting);
          });
    io?.observe(canvas);
    if (animate) raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io?.disconnect();
    };
  }, [animate, reducedMotion, aspect]);

  const redraw = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && sizeRef.current.width > 0) drawRef.current(ctx, sizeRef.current);
  };

  return { canvasRef, redraw, sizeRef };
}
