/**
 * Medidor de nível com zonas (verde/âmbar/vermelho) e indicador de clipping.
 *
 * O nível chega a 10 Hz e a barra tem 28 segmentos. Recriar 28 elementos React
 * por atualização custava caro no WebView do Android: os segmentos (e as zonas,
 * que só dependem do índice) são montados uma vez e o estado ligado/desligado é
 * alternado direto no DOM — só os segmentos da fronteira mudam de fato.
 */
import { useEffect, useMemo, useRef } from 'react';

interface Props {
  peak: number;
  levelDb: number;
  clipping: boolean;
  segments?: number;
}

const SEGMENTS = 28;
/** Escala: -60 dBFS → 0; faz o mapeamento linear em dB. */
const dbFor = (index: number): number => -60 + (index / (SEGMENTS - 1)) * 60;
const zoneFor = (segDb: number): string => (segDb > -3 ? 'danger' : segDb > -12 ? 'warn' : '');

export function LevelMeter({ peak, levelDb, clipping, segments = SEGMENTS }: Props) {
  const linear = Math.max(peak, Math.pow(10, levelDb / 20));
  const db = linear > 1e-6 ? 20 * Math.log10(linear) : -120;
  const active = Math.round(Math.max(0, Math.min(1, (db + 60) / 60)) * segments);
  const pct = Math.round(Math.max(0, Math.min(1, (db + 60) / 60)) * 100);

  const segRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const segmentEls = useMemo(
    () =>
      Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            segRefs.current[i] = el;
          }}
          className={`level-seg ${zoneFor(dbFor(i))}`.trimEnd()}
        />
      )),
    [segments],
  );

  useEffect(() => {
    const refs = segRefs.current;
    for (let i = 0; i < segments; i++) {
      // `toggle` com força não mexe no atributo quando o estado já é o desejado
      refs[i]?.classList.toggle('on', i < active);
    }
  }, [active, segments]);

  return (
    <div
      className="level-meter"
      role="meter"
      aria-valuemin={-60}
      aria-valuemax={0}
      aria-valuenow={Math.round(db)}
      aria-label="Nível de entrada"
    >
      {segmentEls}
      <span className="sr-only">{`${pct}% de nível`}</span>
      {clipping && (
        <span className="chip danger" style={{ marginLeft: 8 }}>
          CLIP
        </span>
      )}
    </div>
  );
}
