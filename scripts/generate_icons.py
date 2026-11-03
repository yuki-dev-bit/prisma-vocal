#!/usr/bin/env python3
"""
Gera os ícones do Prisma Vocal (PNG 1024 + conjunto Linux + .ico Windows).

Identidade visual: um prisma que refrata uma onda sonora em três bandas —
azul-claro, branco e rosa — as cores da bandeira trans, integradas como
refração de luz em vez de "adesivo" sobre o ícone.

Requisitos: Pillow (dev-only). Os arquivos gerados são versionados, então
contribuidores não precisam rodar este script.

Uso:  python3 scripts/generate_icons.py
"""
from __future__ import annotations

import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
ICONS = os.path.join(BUILD, "icons")

S = 4096  # canvas de trabalho (supersampling)
SCALE = S / 1024.0

INK_TOP = (14, 17, 26, 255)
INK_BOTTOM = (9, 11, 17, 255)
BLUE = (91, 206, 250)
PINK = (245, 169, 184)
WHITE = (255, 255, 255)


def sc(v: float) -> float:
    return v * SCALE


def rounded_mask(size: int, radius: float) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return mask


def vertical_gradient(size: int, top, bottom) -> Image.Image:
    grad = Image.new("RGB", (1, size))
    for y in range(size):
        t = y / max(1, size - 1)
        grad.putpixel(
            (0, y),
            (
                round(top[0] + (bottom[0] - top[0]) * t),
                round(top[1] + (bottom[1] - top[1]) * t),
                round(top[2] + (bottom[2] - top[2]) * t),
            ),
        )
    return grad.resize((size, size), Image.BICUBIC)


def wave_path(y_center: float, amp: float, phase: float, x0: float, x1: float, steps: int = 220):
    pts = []
    for i in range(steps + 1):
        t = i / steps
        x = x0 + (x1 - x0) * t
        # envelope: cresce ao sair do prisma
        env = min(1.0, max(0.0, (x - x0) / max(1.0, (x1 - x0) * 0.45)))
        y = y_center + amp * env * math.sin(t * math.pi * 2.35 + phase)
        pts.append((x, y))
    return pts


def draw_stroke(draw: ImageDraw.ImageDraw, pts, width: float, color, steps: int = 900):
    """Traço suave: estampa discos ao longo da curva (evita serrilhado do line/joint)."""
    r = width / 2.0
    # reamostra a polilinha para densidade uniforme
    dense = []
    for i in range(len(pts) - 1):
        (x0, y0), (x1, y1) = pts[i], pts[i + 1]
        seg = max(2, int(math.hypot(x1 - x0, y1 - y0) / 6))
        for k in range(seg):
            t = k / seg
            dense.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
    dense.append(pts[-1])
    for (x, y) in dense:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=color)


def build_icon() -> Image.Image:
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    bg = vertical_gradient(S, INK_TOP, INK_BOTTOM).convert("RGBA")
    base.paste(bg, (0, 0), rounded_mask(S, sc(228)))

    # brilho suave no canto superior esquerdo
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([sc(-260), sc(-320), sc(620), sc(520)], fill=(91, 206, 250, 26))
    gd.ellipse([sc(520), sc(600), sc(1320), sc(1380)], fill=(245, 169, 184, 22))
    glow = glow.filter(ImageFilter.GaussianBlur(sc(120)))
    base.alpha_composite(Image.composite(glow, Image.new("RGBA", (S, S), (0, 0, 0, 0)), rounded_mask(S, sc(228))))

    # ---- prismas e ondas ----
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    cx, cy = sc(430), sc(516)
    w = sc(178)
    h = sc(300)
    apex = (cx, cy - h)
    left = (cx - w, cy + h * 0.80)
    right = (cx + w, cy + h * 0.80)
    triangle = [left, right, apex]
    d.polygon(triangle, fill=(255, 255, 255, 14))

    def edge_x(y: float, side: str) -> float:
        """Interpola x na face esquerda/direita do prisma para uma altura y."""
        t = (y - apex[1]) / (left[1] - apex[1])
        t = min(1.0, max(0.0, t))
        return apex[0] + (left[0] - apex[0]) * t if side == "left" else apex[0] + (right[0] - apex[0]) * t

    # onda incidente (branca): termina exatamente na face esquerda
    y_in = cy + sc(6)
    incoming = wave_path(y_in, sc(68), 0.0, sc(74), edge_x(y_in, "left") - sc(6))
    draw_stroke(d, incoming, sc(27), (255, 255, 255, 236))

    # bandas refratadas (azul-claro, branco, rosa — bandeira trans)
    bands = [
        (BLUE + (255,), cy - sc(158), sc(66), 0.55),
        (WHITE + (255,), cy - sc(6), sc(52), 0.0),
        (PINK + (255,), cy + sc(146), sc(66), -0.55),
    ]
    for color, y, amp, phase in bands:
        start_x = edge_x(y, "right") + sc(4)
        pts = wave_path(y, amp, phase, start_x, sc(942))
        draw_stroke(d, pts, sc(31), color)

    # contorno do prisma por cima das bandas
    d.line([*triangle, triangle[0]], fill=(255, 255, 255, 232), width=int(sc(16)), joint="curve")
    for p in triangle:
        d.ellipse([p[0] - sc(8), p[1] - sc(8), p[0] + sc(8), p[1] + sc(8)], fill=(255, 255, 255, 232))

    # brilho aditivo das bandas
    band_glow = layer.filter(ImageFilter.GaussianBlur(sc(28)))
    base.alpha_composite(Image.blend(Image.new("RGBA", (S, S), (0, 0, 0, 0)), band_glow, 0.55))
    base.alpha_composite(layer)

    # traço interno sutil na borda
    edge = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ed = ImageDraw.Draw(edge)
    ed.rounded_rectangle(
        [sc(3), sc(3), S - sc(3), S - sc(3)], radius=sc(226), outline=(255, 255, 255, 42), width=int(sc(4))
    )
    base.alpha_composite(Image.composite(edge, Image.new("RGBA", (S, S), (0, 0, 0, 0)), rounded_mask(S, sc(228))))
    return base


def main() -> None:
    os.makedirs(BUILD, exist_ok=True)
    os.makedirs(ICONS, exist_ok=True)
    icon = build_icon()

    icon_1024 = icon.resize((1024, 1024), Image.LANCZOS)
    icon_1024.save(os.path.join(BUILD, "icon.png"), optimize=True)

    for size in (1024, 512, 256, 128, 64, 48, 32, 24, 16):
        icon.resize((size, size), Image.LANCZOS).save(os.path.join(ICONS, f"{size}x{size}.png"), optimize=True)

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    icon.resize((256, 256), Image.LANCZOS).save(
        os.path.join(BUILD, "icon.ico"), sizes=ico_sizes, format="ICO"
    )

    # installers: imagem de fundo do NSIS (sidebar) e ícone do macOS
    icon.resize((512, 512), Image.LANCZOS).save(os.path.join(BUILD, "icon-512.png"), optimize=True)
    try:
        icon.resize((1024, 1024), Image.LANCZOS).save(os.path.join(BUILD, "icon.icns"), format="ICNS")
    except Exception as exc:  # pragma: no cover - depende do build do Pillow
        print(f"[icons] ICNS não gerado ({exc}); electron-builder converterá icon.png.")

    print("[icons] gerados em build/ e build/icons/")


if __name__ == "__main__":
    main()
