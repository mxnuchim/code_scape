"use client";

import { useState } from "react";

/** The owner's GitHub avatar, falling back to a monogram tile. */
export function RepoAvatar({ owner, size = 32 }: { owner: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size };
  if (failed) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-[10px] bg-gradient-to-br from-[#8fbbe6] to-[#f7d9bd] font-display font-bold text-white"
        style={{ ...style, fontSize: size * 0.45 }}
        aria-hidden
      >
        {owner.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    // A plain img keeps this free of image-optimizer config; the avatar is tiny.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://github.com/${encodeURIComponent(owner)}.png?size=${size * 2}`}
      alt=""
      width={size}
      height={size}
      className="shrink-0 rounded-[10px] bg-white/70 ring-1 ring-black/5"
      style={style}
      onError={() => setFailed(true)}
    />
  );
}
