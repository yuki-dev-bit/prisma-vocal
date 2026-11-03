/** Arco de medição (0–100) para ressonância, estabilidade, etc. */

interface Props {
  value: number;
  label: string;
  tag?: string;
  size?: number;
  max?: number;
  invert?: boolean;
}

export function GaugeArc({ value, label, tag, size = 78, max = 100, invert = false }: Props) {
  const clamped = Math.max(0, Math.min(max, Number.isFinite(value) ? value : 0));
  const ratio = clamped / max;
  const radius = size / 2 - 7;
  const circumference = Math.PI * radius; // semicírculo
  const dash = circumference * (invert ? 1 - ratio : ratio);

  return (
    <div className="gauge">
      <svg
        width={size}
        height={size * 0.62}
        viewBox={`0 0 ${size} ${size * 0.62}`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`g-${label.replace(/\W/g, '')}`} x1="0" x2="1">
            <stop offset="0%" stopColor="var(--blue)" />
            <stop offset="100%" stopColor="var(--pink)" />
          </linearGradient>
        </defs>
        <path
          d={`M 7 ${size * 0.55} A ${radius} ${radius} 0 0 1 ${size - 7} ${size * 0.55}`}
          fill="none"
          stroke="rgba(255,255,255,0.1)"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d={`M 7 ${size * 0.55} A ${radius} ${radius} 0 0 1 ${size - 7} ${size * 0.55}`}
          fill="none"
          stroke={`url(#g-${label.replace(/\W/g, '')})`}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
        />
      </svg>
      <span className="gauge-value">{Math.round(clamped)}</span>
      <span className="gauge-label">{label}</span>
      {tag && <span className="gauge-tag">{tag}</span>}
    </div>
  );
}
