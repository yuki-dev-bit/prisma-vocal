/**
 * Marca do Prisma Vocal em SVG — mesma linguagem do ícone do app:
 * um prisma de contorno claro refrata uma onda em três bandas
 * (azul-claro, branco, rosa).
 */

export function LogoMark({
  size = 34,
  withBackground = true,
}: {
  size?: number;
  withBackground?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className="brand-mark"
      role="img"
      aria-label="Prisma Vocal"
    >
      <defs>
        <linearGradient id="pv-bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#141a26" />
          <stop offset="100%" stopColor="#080b11" />
        </linearGradient>
        <linearGradient id="pv-edge" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#dff1ff" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0.82" />
        </linearGradient>
      </defs>
      {withBackground && (
        <>
          <rect x="0" y="0" width="64" height="64" rx="15" fill="url(#pv-bg)" />
          <rect
            x="0.6"
            y="0.6"
            width="62.8"
            height="62.8"
            rx="14.6"
            stroke="rgba(255,255,255,0.16)"
            strokeWidth="1.2"
          />
        </>
      )}
      {/* onda incidente */}
      <path
        d="M5 33.5c3.2 0 3.4-4.6 6.6-4.6s3.2 4.6 6.4 4.6 3.3-4.6 6.5-4.6"
        stroke="#ffffff"
        strokeOpacity="0.92"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* prisma */}
      <path
        d="M27 15.5 40.5 43H13.5z"
        fill="rgba(255,255,255,0.07)"
        stroke="url(#pv-edge)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* bandas refratadas */}
      <path
        d="M41.5 20.5c4.2 0 4.2 3.2 8.4 3.2s4.2-3.2 8.1-3.2"
        stroke="#5bcefa"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M40 31c4.4 0 4.4 3.4 8.8 3.4S53.2 31 57.4 31"
        stroke="#ffffff"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
      <path
        d="M38.5 41.5c4.6 0 4.6 3.6 9.2 3.6s4.6-3.6 9.7-3.6"
        stroke="#f5a9b8"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand-text">
      <span className="brand-name">Prisma Vocal</span>
      {!compact && <span className="brand-sub">treino de voz · offline</span>}
    </div>
  );
}
