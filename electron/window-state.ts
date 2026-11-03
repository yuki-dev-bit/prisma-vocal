/**
 * Geometria e memória da janela principal (funções puras, sem Electron).
 *
 * Por que existe: a janela era criada sempre em 1280×860, na posição padrão do
 * sistema, sem memória de tamanho/posição. Em telas pequenas (1366×768, 1024×600)
 * ou com a janela reposicionada em um segundo monitor, o app abria maior que a
 * área útil ou fora da tela — e o usuário precisava corrigir isso toda vez.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  bounds: Rect;
  maximized: boolean;
}

export const DEFAULT_WINDOW = { width: 1280, height: 860 };
export const MIN_WINDOW = { width: 940, height: 640 };
/** Quanto da janela precisa estar visível para não reprovar a posição salva. */
const MIN_VISIBLE_PX = 120;
/** Altura da barra de título — garante que o "arrastar" continue alcançável. */
const TITLEBAR_PX = 40;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Valida o formato lido do disco. Qualquer coisa estranha vira `null`. */
export function parseWindowState(raw: unknown): WindowState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const b = r.bounds as Record<string, unknown> | undefined;
  if (!b) return null;
  if (
    !isFiniteNumber(b.x) ||
    !isFiniteNumber(b.y) ||
    !isFiniteNumber(b.width) ||
    !isFiniteNumber(b.height)
  ) {
    return null;
  }
  if (b.width < 200 || b.height < 200 || b.width > 10000 || b.height > 10000) return null;
  return {
    bounds: {
      x: Math.round(b.x),
      y: Math.round(b.y),
      width: Math.round(b.width),
      height: Math.round(b.height),
    },
    maximized: r.maximized === true,
  };
}

/**
 * Ajusta o estado desejado para caber na área útil de um monitor.
 *
 * Regras:
 *  • tamanho nunca maior que a área útil (senão o app abre "cortado");
 *  • tamanho nunca menor que o mínimo, exceto se a área útil for menor que ele;
 *  • posição só é mantida se pelo menos uma faixa da janela (e a barra de título)
 *    estiver dentro da área útil — caso contrário, centraliza.
 */
export function fitToWorkArea(
  saved: WindowState | null,
  workArea: Rect,
  minSize = MIN_WINDOW,
): WindowState {
  const minWidth = Math.min(minSize.width, workArea.width);
  const minHeight = Math.min(minSize.height, workArea.height);

  if (!saved) {
    const width = clamp(DEFAULT_WINDOW.width, minWidth, workArea.width);
    const height = clamp(DEFAULT_WINDOW.height, minHeight, workArea.height);
    return {
      bounds: {
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: Math.round(workArea.y + (workArea.height - height) / 2),
        width,
        height,
      },
      maximized: false,
    };
  }

  const width = clamp(saved.bounds.width, minWidth, workArea.width);
  const height = clamp(saved.bounds.height, minHeight, workArea.height);

  const right = saved.bounds.x + width;
  const bottom = saved.bounds.y + height;
  const horizontallyVisible =
    right - workArea.x >= MIN_VISIBLE_PX &&
    saved.bounds.x <= workArea.x + workArea.width - MIN_VISIBLE_PX;
  // A parte de cima precisa aparecer para a barra de título ser alcançável.
  const verticallyVisible =
    bottom - workArea.y >= TITLEBAR_PX + MIN_VISIBLE_PX &&
    saved.bounds.y <= workArea.y + workArea.height - TITLEBAR_PX;

  if (!horizontallyVisible || !verticallyVisible) {
    return {
      bounds: {
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: Math.round(workArea.y + (workArea.height - height) / 2),
        width,
        height,
      },
      maximized: saved.maximized,
    };
  }

  return {
    bounds: { x: Math.round(saved.bounds.x), y: Math.round(saved.bounds.y), width, height },
    maximized: saved.maximized,
  };
}

/** Tamanho mínimo utilizável para um monitor específico (nunca maior que ele). */
export function effectiveMinSize(
  workArea: Rect,
  minSize = MIN_WINDOW,
): { width: number; height: number } {
  return {
    width: Math.min(minSize.width, Math.max(400, workArea.width)),
    height: Math.min(minSize.height, Math.max(300, workArea.height)),
  };
}
