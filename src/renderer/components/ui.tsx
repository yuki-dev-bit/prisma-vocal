/** Componentes de interface reutilizáveis (sem biblioteca externa). */
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { FeedbackItem, SessionMetrics } from '../../shared/types';
import { IconAlert, IconCheck, IconInfo, IconSparkle, IconWave } from './Icons';
import { METRIC_LABEL, METRIC_UNIT } from '../../core/training/evaluate';
import { noteName } from '../../core/utils/math';

/* ------------------------------- Modal ------------------------------- */

export function Modal({
  title,
  children,
  onClose,
  footer,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const focusables = ref.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button, input, textarea')?.focus();
    // Trava a rolagem do fundo enquanto o diálogo está aberto.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  /**
   * Portal para o `body`: dentro de `.main` (que tem `z-index: 1`) o modal
   * ficava preso nesse contexto de empilhamento e a barra lateral/barra
   * inferior (z-index 2) era pintada POR CIMA do fundo escurecido — dava para
   * tocar na navegação com um diálogo aberto.
   */
  return createPortal(
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        style={wide ? { width: 'min(820px, 100%)' } : undefined}
      >
        <div className="row" style={{ marginBottom: 'var(--sp-4)' }}>
          <h2 className="h2" style={{ flex: 1, fontSize: 'var(--fs-lg)' }}>
            {title}
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </div>
        {children}
        {footer && (
          <div className="row" style={{ marginTop: 'var(--sp-5)', justifyContent: 'flex-end' }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------- Formas ------------------------------- */

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="switch" style={{ opacity: disabled ? 0.5 : 1 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="switch-track" aria-hidden="true" />
      <span>
        <span style={{ fontSize: 'var(--fs-sm)' }}>{label}</span>
        {hint && (
          <span className="hint" style={{ display: 'block' }}>
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  hint,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  hint?: string;
  format?: (v: number) => string;
}) {
  return (
    <div className="field">
      <div className="row">
        <span className="label" style={{ flex: 1 }}>
          {label}
        </span>
        <span className="mono small faint">
          {format ? format(value) : `${value}${unit ? ` ${unit}` : ''}`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        aria-valuetext={format ? format(value) : `${value}${unit}`}
      />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <IconWave size={26} />
      <div>
        <div style={{ color: 'var(--text)', fontSize: 'var(--fs-sm)', fontWeight: 560 }}>
          {title}
        </div>
        <div className="small" style={{ maxWidth: '46ch', marginTop: 4 }}>
          {body}
        </div>
      </div>
      {action}
    </div>
  );
}

/* ------------------------------- Métricas ------------------------------- */

export function MetricCard({
  metric,
  value,
  max = 100,
  hint,
  tone,
}: {
  metric: keyof typeof METRIC_LABEL;
  value: number | null;
  max?: number;
  hint?: string;
  tone?: 'good' | 'warn' | 'neutral';
}) {
  const unit = METRIC_UNIT[metric];
  const display =
    value === null || !Number.isFinite(value)
      ? '—'
      : Math.abs(value) >= 100
        ? Math.round(value).toString()
        : (Math.round(value * 10) / 10).toString();
  const pct = value === null ? 0 : Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <div className="metric-card">
      <div className="metric-head">
        <span className="metric-name">{METRIC_LABEL[metric]}</span>
        {tone === 'good' && <span className="chip ok tiny">bom</span>}
        {tone === 'warn' && <span className="chip warn tiny">atenção</span>}
      </div>
      <div className="metric-value">
        {display}
        <span className="readout-unit">{unit}</span>
      </div>
      <div className="metric-bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function MetricsGrid({ metrics }: { metrics: SessionMetrics }) {
  const pitchTone =
    metrics.f0Stability >= 70 ? 'good' : metrics.f0Stability < 55 ? 'warn' : 'neutral';
  return (
    <div className="grid cols-4">
      <MetricCard
        metric="f0MedianHz"
        value={metrics.f0MedianHz}
        max={Math.max(300, (metrics.f0MedianHz ?? 200) * 1.6)}
        hint={
          metrics.f0MedianHz
            ? `${noteName(metrics.f0MedianHz)} · faixa ${metrics.f0RangeSt.toFixed(1)} st`
            : 'sem voz detectada'
        }
      />
      <MetricCard
        metric="f0Stability"
        value={metrics.f0Stability}
        hint={metrics.f0Stability >= 70 ? 'altura firme' : 'oscilação perceptível'}
        tone={pitchTone as 'good' | 'warn' | 'neutral'}
      />
      <MetricCard
        metric="resonanceIndex"
        value={metrics.resonanceIndex}
        hint={`inclinação ${metrics.tiltDbPerOct?.toFixed(1) ?? '—'} dB/8va`}
      />
      <MetricCard
        metric="hnrDb"
        value={metrics.hnrMedianDb}
        max={30}
        hint={`soprosidade ${(metrics.breathiness * 100).toFixed(0)}/100`}
      />
    </div>
  );
}

/* ------------------------------- Feedback ------------------------------- */

const FEEDBACK_ICON = {
  sucesso: IconCheck,
  atencao: IconAlert,
  dica: IconSparkle,
  info: IconInfo,
} as const;

export function FeedbackList({ items }: { items: FeedbackItem[] }) {
  if (items.length === 0)
    return <EmptyState title="Sem observações" body="Nada relevante apareceu nesta tomada." />;
  return (
    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      {items.map((item) => {
        const Icon = FEEDBACK_ICON[item.severity] ?? IconInfo;
        return (
          <article key={item.id} className={`feedback-item ${item.severity}`}>
            <Icon className="feedback-icon" />
            <div>
              <h4 className="feedback-title">{item.title}</h4>
              <p className="feedback-text">
                <strong>O que:</strong> {item.what}
              </p>
              <p className="feedback-text">
                <strong>Por quê:</strong> {item.why}
              </p>
              <p className="feedback-text">
                <strong>Como:</strong> {item.how}
              </p>
              {item.evidence.length > 0 && (
                <div className="kv">
                  {item.evidence.map((e, i) => (
                    <span className="chip tiny" key={`${item.id}-${i}`}>
                      {e.label}: <span className="mono">{e.value}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* ------------------------------- Histórico ------------------------------- */

export interface HistoryPoint {
  t: string;
  value: number | null;
}

export function HistoryChart({
  points,
  label,
  unit,
  height = 148,
  color = 'var(--blue)',
}: {
  points: HistoryPoint[];
  label: string;
  unit: string;
  height?: number;
  color?: string;
}) {
  const valid = points.filter((p) => p.value !== null && Number.isFinite(p.value)) as {
    t: string;
    value: number;
  }[];
  if (valid.length < 2) {
    return (
      <EmptyState
        title="Dados insuficientes"
        body="Faça pelo menos duas sessões para ver a evolução desta métrica."
      />
    );
  }
  const values = valid.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = (max - min) * 0.18 || Math.max(1, max * 0.1);
  const lo = min - pad;
  const hi = max + pad;
  const W = 640;
  const H = height;
  const x = (i: number) => 8 + (i / (valid.length - 1)) * (W - 16);
  const y = (v: number) => H - 22 - ((v - lo) / (hi - lo)) * (H - 40);
  const path = valid
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(' ');
  const area = `${path} L${x(valid.length - 1)},${H - 22} L${x(0)},${H - 22} Z`;

  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <span className="label" style={{ flex: 1 }}>
          {label}
        </span>
        <span className="mono tiny faint">
          {valid[0].value.toFixed(1)} → {valid[valid.length - 1].value.toFixed(1)} {unit}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        aria-label={`Evolução de ${label}`}
      >
        <defs>
          <linearGradient id={`hist-${label.replace(/\W/g, '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={8}
            x2={W - 8}
            y1={22 + f * (H - 44)}
            y2={22 + f * (H - 44)}
            stroke="rgba(255,255,255,0.06)"
          />
        ))}
        <path d={area} fill={`url(#hist-${label.replace(/\W/g, '')})`} />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {valid.map((p, i) => (
          <circle key={`${p.t}-${i}`} cx={x(i)} cy={y(p.value)} r={2.4} fill={color} />
        ))}
        <text
          x={8}
          y={H - 6}
          fontSize="10"
          fill="rgba(255,255,255,0.34)"
          fontFamily="ui-monospace, monospace"
        >
          {new Date(valid[0].t).toLocaleDateString('pt-BR')}
        </text>
        <text
          x={W - 8}
          y={H - 6}
          fontSize="10"
          textAnchor="end"
          fill="rgba(255,255,255,0.34)"
          fontFamily="ui-monospace, monospace"
        >
          {new Date(valid[valid.length - 1].t).toLocaleDateString('pt-BR')}
        </text>
      </svg>
    </div>
  );
}
