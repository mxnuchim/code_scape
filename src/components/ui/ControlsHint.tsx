"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useMediaQuery } from "./common";
import { IconClose } from "./icons";

const KEY = "codescape:controls-hint-seen";

function seen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

function remember() {
  try {
    window.localStorage.setItem(KEY, "1");
  } catch {
    // Private mode or blocked storage: the hint just shows again next time.
  }
}

/** A one-time nudge on how to move around, dismissed by any interaction. */
export function ControlsHint() {
  const touch = useMediaQuery("(pointer: coarse)");
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (seen()) return;
    const start = window.setTimeout(() => setShow(true), 600);
    const dismiss = () => {
      setShow(false);
      remember();
    };
    const auto = window.setTimeout(dismiss, 11000);
    let armed = false;
    const arm = window.setTimeout(() => (armed = true), 2200);
    const onInteract = () => armed && dismiss();
    window.addEventListener("pointerdown", onInteract);
    window.addEventListener("wheel", onInteract, { passive: true });
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(auto);
      window.clearTimeout(arm);
      window.removeEventListener("pointerdown", onInteract);
      window.removeEventListener("wheel", onInteract);
    };
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="absolute inset-x-0 top-[78px] flex justify-center px-4 sm:top-20"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
        >
          <div className="glass pointer-events-auto flex items-center gap-3 rounded-lg py-1.5 pr-1.5 pl-3.5 text-[0.8rem] text-ink-soft">
            {touch ? (
              <span>Drag to orbit · pinch to zoom · two fingers to pan · tap a building</span>
            ) : (
              <span>
                <b className="text-ink">Drag</b> to orbit · <b className="text-ink">right-drag</b> to pan · <b className="text-ink">scroll</b> to zoom ·{" "}
                <b className="text-ink">WASD</b> to fly · <b className="text-ink">click</b> a building
              </span>
            )}
            <button
              type="button"
              className="icon-btn h-7 w-7"
              aria-label="Dismiss"
              onClick={() => {
                setShow(false);
                remember();
              }}
            >
              <IconClose size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
