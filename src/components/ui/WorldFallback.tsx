"use client";

import { BrandMark } from "./icons";

const COPY = {
  unsupported: {
    title: "This browser can’t draw the city",
    body: "CodeScape needs WebGL 2. It may be turned off, or blocked by your browser or device settings. A recent Chrome, Edge, Firefox or Safari should work.",
  },
  "context-lost": {
    title: "The 3D view stopped",
    body: "Your graphics device reset the 3D canvas. That can happen when a laptop switches GPUs or memory runs low. Reloading usually brings it back.",
  },
  crash: {
    title: "The 3D view hit a problem",
    body: "Something went wrong while drawing the city. Reloading the page should fix it.",
  },
} as const;

export function WorldFallback({ reason }: { reason: keyof typeof COPY }) {
  const copy = COPY[reason];
  return (
    <div className="pointer-events-auto absolute inset-0 z-50 grid place-items-center p-4">
      <section role="alert" className="glass-strong w-full max-w-[460px] rounded-xl p-6 text-center">
        <div className="mx-auto mb-3 w-fit">
          <BrandMark size={44} />
        </div>
        <h2 className="text-[17px] font-semibold tracking-tight">{copy.title}</h2>
        <p className="mt-2 text-[0.9rem] leading-relaxed text-ink-soft">{copy.body}</p>
        <button type="button" className="btn btn-primary mt-5 px-5 py-2.5 text-sm" onClick={() => window.location.reload()}>
          Reload
        </button>
      </section>
    </div>
  );
}
