import type { SVGProps } from "react";
import type { Archetype } from "@/lib/layout/archetypes";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    ...rest,
  };
}

export const IconSearch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </svg>
);
export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconHome = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 11.5 12 5l8 6.5" />
    <path d="M6.5 10v9h11v-9" />
  </svg>
);
export const IconZoomIn = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 6v12M6 12h12" />
  </svg>
);
export const IconZoomOut = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 12h12" />
  </svg>
);
export const IconTransit = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="6" cy="17" r="2.2" />
    <circle cx="18" cy="7" r="2.2" />
    <path d="M7.6 15.4C9 9 13 8.5 15.9 8.1" strokeDasharray="2.4 2.4" />
  </svg>
);
export const IconHelp = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2-2.4 3.7" />
    <path d="M12 17h.01" />
  </svg>
);
export const IconClose = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
);
export const IconExternal = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M14 5h5v5" />
    <path d="M19 5 11 13" />
    <path d="M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4" />
  </svg>
);
export const IconCopy = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="8.5" y="8.5" width="10" height="10" rx="2" />
    <path d="M15.5 8.5V6.5a1 1 0 0 0-1-1h-8a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h2" />
  </svg>
);
export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m5 12.5 4.2 4.2L19 7" />
  </svg>
);
export const IconFolder = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h4l2 2h7A1.5 1.5 0 0 1 20 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
  </svg>
);
export const IconFile = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 4h7l4 4v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />
    <path d="M14 4v4h4" />
  </svg>
);
export const IconStar = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m12 4.5 2.3 4.7 5.2.7-3.8 3.6.9 5.1L12 16.2l-4.6 2.4.9-5.1L4.5 9.9l5.2-.7z" />
  </svg>
);
export const IconBranch = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="7" cy="6" r="2" />
    <circle cx="7" cy="18" r="2" />
    <circle cx="17" cy="8" r="2" />
    <path d="M7 8v8M17 10c0 4-6 3.5-9.4 6.4" />
  </svg>
);
export const IconAlert = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4.5 21 19.5H3z" />
    <path d="M12 10v4.2M12 17.2h.01" />
  </svg>
);
export const IconClock = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
export const IconLayers = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m12 4 8.5 4.5L12 13 3.5 8.5z" />
    <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
    <path d="m3.5 16.5 8.5 4.5 8.5-4.5" opacity=".5" />
  </svg>
);
export const IconArrowRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const IconChevron = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
);
export const IconTarget = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="2.5" />
  </svg>
);
export const IconIsolate = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4" y="4" width="16" height="16" rx="3" strokeDasharray="3 3" />
    <rect x="8.5" y="8.5" width="7" height="7" rx="1.5" />
  </svg>
);
export const IconSparkle = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.5c.6 4.3 2.2 6 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.5 5.9-2.2 6.5-6.5z" />
    <path d="M18.5 15.5c.3 1.7.9 2.3 2.5 2.5-1.6.3-2.2.9-2.5 2.5-.3-1.6-.9-2.2-2.5-2.5 1.6-.2 2.2-.8 2.5-2.5z" />
  </svg>
);

export const IconGitHub = ({ size = 18, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
    <path d="M12 2.2a9.9 9.9 0 0 0-3.13 19.29c.5.09.68-.21.68-.48v-1.68c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.75c0 .27.18.58.69.48A9.9 9.9 0 0 0 12 2.2z" />
  </svg>
);

/** Brand mark: a tiny skyline in a rounded tile. */
export const BrandMark = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
    <defs>
      <linearGradient id="bm-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#8fbbe6" />
        <stop offset="1" stopColor="#f7d9bd" />
      </linearGradient>
    </defs>
    <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#bm-sky)" />
    <rect x="5" y="17" width="5" height="9" rx="1.2" fill="#f3cd57" />
    <rect x="11" y="9" width="6" height="17" rx="1.3" fill="#5b8ee6" />
    <rect x="18" y="13" width="5" height="13" rx="1.2" fill="#4fae9b" />
    <path d="M23.5 26v-6l2.5-2.4 2.5 2.4V26z" fill="#e8765a" />
    <rect x="12.6" y="12" width="1.2" height="1.6" rx=".3" fill="#ffe7a3" />
    <rect x="14.4" y="15" width="1.2" height="1.6" rx=".3" fill="#ffe7a3" />
    <rect x="12.6" y="18" width="1.2" height="1.6" rx=".3" fill="#ffe7a3" />
    <rect x="3" y="25.6" width="26" height="2.6" rx="1.3" fill="#a6cc7c" />
  </svg>
);

/** Little silhouettes so the legend shows the same shapes as the world. */
export function ArchetypeGlyph({ archetype, size = 18, color = "currentColor" }: { archetype: Archetype; size?: number; color?: string }) {
  const f = { fill: color };
  const shapes: Record<Archetype, React.ReactNode> = {
    tower: (
      <>
        <rect x="7" y="3.5" width="10" height="17" rx="1.6" {...f} />
        <rect x="9.3" y="6.5" width="1.8" height="2" rx=".4" fill="white" opacity=".75" />
        <rect x="12.9" y="6.5" width="1.8" height="2" rx=".4" fill="white" opacity=".75" />
        <rect x="9.3" y="10.5" width="1.8" height="2" rx=".4" fill="white" opacity=".75" />
        <rect x="12.9" y="14.5" width="1.8" height="2" rx=".4" fill="white" opacity=".75" />
      </>
    ),
    lab: (
      <>
        <rect x="5.5" y="13" width="13" height="7.5" rx="1.4" {...f} />
        <path d="M6.5 13a5.5 5.5 0 0 1 11 0z" {...f} opacity=".6" />
      </>
    ),
    silo: (
      <>
        <rect x="8" y="9" width="8" height="11.5" rx="1.2" {...f} />
        <path d="M7 9.5 12 3.5l5 6z" {...f} opacity=".7" />
      </>
    ),
    factory: (
      <>
        <path d="M4 20.5V12l4 2.6V12l4 2.6V12l4 2.6V9h4v11.5z" {...f} />
        <rect x="16.2" y="4" width="2.6" height="5.5" rx=".6" {...f} opacity=".7" />
      </>
    ),
    house: (
      <>
        <rect x="6" y="11.5" width="12" height="9" rx="1" {...f} />
        <path d="M4.5 12 12 5l7.5 7z" {...f} opacity=".7" />
      </>
    ),
    pavilion: (
      <>
        <rect x="7" y="12.5" width="10" height="8" rx="1.2" {...f} />
        <path d="M5 12.8 12 6l7 6.8z" {...f} opacity=".7" />
      </>
    ),
    warehouse: (
      <>
        <rect x="4" y="12" width="16" height="8.5" rx="1.2" {...f} />
        <path d="M4.5 12.5a7.5 4.8 0 0 1 15 0z" {...f} opacity=".7" />
      </>
    ),
    crates: (
      <>
        <rect x="4.5" y="12" width="9" height="8.5" rx="1.4" {...f} />
        <rect x="12" y="7" width="7" height="6" rx="1.3" {...f} opacity=".7" />
      </>
    ),
    kiosk: (
      <>
        <rect x="8" y="11" width="8" height="9.5" rx="1.2" {...f} />
        <rect x="5.5" y="9" width="13" height="2.4" rx="1" {...f} opacity=".7" />
      </>
    ),
    block: (
      <>
        <rect x="4" y="14" width="16" height="6.5" rx="1.3" {...f} />
        <rect x="6" y="9" width="12" height="5.5" rx="1.2" {...f} opacity=".8" />
        <rect x="8.5" y="4.5" width="7" height="5" rx="1.1" {...f} opacity=".6" />
      </>
    ),
    townhall: (
      <>
        <rect x="4" y="13" width="16" height="7.5" rx="1" {...f} />
        <path d="M8 13a4 4 0 0 1 8 0z" {...f} opacity=".7" />
        <rect x="11.5" y="3.5" width="1" height="5.5" {...f} />
      </>
    ),
    clocktower: (
      <>
        <rect x="8.5" y="8" width="7" height="12.5" rx="1" {...f} />
        <path d="M8 8.5 12 3l4 5.5z" {...f} opacity=".7" />
        <circle cx="12" cy="11.5" r="1.8" fill="white" opacity=".85" />
      </>
    ),
    lighthouse: (
      <>
        <path d="M9 20.5 10.2 8h3.6L15 20.5z" {...f} />
        <rect x="9.6" y="5" width="4.8" height="3" rx=".8" fill="#ffd36b" />
        <path d="M9.4 5 12 2.8 14.6 5z" {...f} opacity=".7" />
      </>
    ),
    monument: (
      <>
        <path d="M10 18 11 5h2l1 13z" {...f} />
        <rect x="7" y="18" width="10" height="2.5" rx=".8" {...f} opacity=".7" />
      </>
    ),
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {shapes[archetype]}
    </svg>
  );
}
