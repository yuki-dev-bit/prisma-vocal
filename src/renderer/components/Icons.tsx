/** Conjunto de ícones em SVG (traço 1.6, 24×24). Sem dependências externas. */
import React from 'react';

type P = { size?: number; className?: string; title?: string; style?: React.CSSProperties };

const base = (props: P, children: React.ReactNode, viewBox = '0 0 24 24') => (
  <svg
    width={props.size ?? 18}
    height={props.size ?? 18}
    viewBox={viewBox}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={props.className}
    style={props.style}
    aria-hidden={props.title ? undefined : true}
    role={props.title ? 'img' : undefined}
  >
    {props.title ? <title>{props.title}</title> : null}
    {children}
  </svg>
);

export const IconHome = (p: P) =>
  base(
    p,
    <>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.8V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V9.8" />
      <path d="M10 20v-5h4v5" />
    </>,
  );
export const IconWave = (p: P) =>
  base(
    p,
    <>
      <path d="M2 12h2.2l2-6 2.4 12L11 6l2.3 12 2.2-6H22" />
    </>,
  );
export const IconBook = (p: P) =>
  base(
    p,
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v14H6.5A2.5 2.5 0 0 0 4 19.5z" />
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20v4H6.5A2.5 2.5 0 0 1 4 19.5z" />
    </>,
  );
export const IconClipboard = (p: P) =>
  base(
    p,
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3h6v1" />
      <path d="m8.8 13.4 2 2 4.6-4.8" />
    </>,
  );
export const IconMic = (p: P) =>
  base(
    p,
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
      <path d="M9 21h6" />
    </>,
  );
export const IconDisc = (p: P) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.4" />
    </>,
  );
export const IconJournal = (p: P) =>
  base(
    p,
    <>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8.5 9h7M8.5 13h7M8.5 17h4" />
    </>,
  );
export const IconChart = (p: P) =>
  base(
    p,
    <>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7 15 3.5-4.5 3 2.5L20 7" />
    </>,
  );
export const IconSettings = (p: P) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path
        d="M19.4 14.5a7.6 7.6 0 0 0 0-5l1.6-1.2-1.9-3.3-1.9.8a7.6 7.6 0 0 0-4.3-2.5L12.4 1h-3.8l-.5 2a7.6 7.6 0 0 0-4.3 2.5l-1.9-.8L0 8.3l1.6 1.2a7.6 7.6 0 0 0 0 5L0 15.7l1.9 3.3 1.9-.8a7.6 7.6 0 0 0 4.3 2.5l.5 2h3.8l.5-2a7.6 7.6 0 0 0 4.3-2.5l1.9.8 1.9-3.3z"
        transform="translate(2.2 0) scale(0.82)"
      />
    </>,
  );
export const IconPlay = (p: P) => base(p, <path d="M8 5.5v13l11-6.5z" />);
export const IconStop = (p: P) => base(p, <rect x="6.5" y="6.5" width="11" height="11" rx="2" />);
export const IconRecord = (p: P) =>
  base(p, <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />);
export const IconTrash = (p: P) =>
  base(
    p,
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>,
  );
export const IconDownload = (p: P) =>
  base(
    p,
    <>
      <path d="M12 4v11" />
      <path d="m7.5 11 4.5 4.5L16.5 11" />
      <path d="M5 20h14" />
    </>,
  );
export const IconUpload = (p: P) =>
  base(
    p,
    <>
      <path d="M12 16V5" />
      <path d="m7.5 9 4.5-4.5L16.5 9" />
      <path d="M5 20h14" />
    </>,
  );
export const IconCheck = (p: P) => base(p, <path d="m5 12.5 4.5 4.5L19 7" />);
export const IconAlert = (p: P) =>
  base(
    p,
    <>
      <path d="M12 4.5 21 19.5H3z" />
      <path d="M12 10v4.2" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </>,
  );
export const IconInfo = (p: P) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </>,
  );
export const IconSparkle = (p: P) =>
  base(
    p,
    <>
      <path d="M12 3.5 13.7 9l5.5 1.7L13.7 12.4 12 18l-1.7-5.6L4.8 10.7 10.3 9z" />
      <path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z" />
    </>,
  );
export const IconChevron = (p: P) => base(p, <path d="m9 6 6 6-6 6" />);
export const IconLock = (p: P) =>
  base(
    p,
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>,
  );
export const IconGithub = (p: P) =>
  base(
    p,
    <path d="M12 2.5a9.5 9.5 0 0 0-3 18.5c.5.1.6-.2.6-.5v-1.9c-2.6.6-3.2-1.2-3.2-1.2-.4-1.1-1-1.4-1-1.4-.9-.6.1-.6.1-.6 1 .1 1.4 1 1.4 1 .8 1.4 2.1 1 2.7.8.1-.6.3-1 .6-1.3-2.1-.2-4.2-1-4.2-4.6 0-1 .4-1.9 1-2.6-.1-.2-.4-1.2.1-2.5 0 0 .8-.3 2.7 1a9 9 0 0 1 4.8 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.4.1 2.6.7.7 1 1.6 1 2.6 0 3.6-2.1 4.4-4.2 4.6.4.3.7 1 .7 2v3c0 .3.1.6.6.5A9.5 9.5 0 0 0 12 2.5z" />,
    '0 0 24 24',
  );
export const IconTarget = (p: P) =>
  base(
    p,
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>,
  );
export const IconFlame = (p: P) =>
  base(p, <path d="M12 3s4.5 4 4.5 8a4.5 4.5 0 0 1-9 0c0-1.4.6-2.5 1.4-3.4C10 9 12 6 12 3z" />);
export const IconCompare = (p: P) =>
  base(
    p,
    <>
      <path d="M7 4v16M17 4v16" />
      <path d="m4 8 3-4 3 4M14 16l3 4 3-4" />
    </>,
  );
export const IconEye = (p: P) =>
  base(
    p,
    <>
      <path d="M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>,
  );
export const IconSave = (p: P) =>
  base(
    p,
    <>
      <path d="M5 4h11l3 3v13H5z" />
      <path d="M8.5 4v5h7V4" />
      <rect x="8.5" y="13" width="7" height="7" rx="1" />
    </>,
  );
export const IconArrowRight = (p: P) =>
  base(
    p,
    <>
      <path d="M4 12h15" />
      <path d="m13.5 6.5 6 5.5-6 5.5" />
    </>,
  );
