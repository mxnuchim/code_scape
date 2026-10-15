"use client";

import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { useState, type ReactNode } from "react";
import { useIsMobile } from "./common";
import { IconClose } from "./icons";

interface SheetProps {
  open: boolean;
  side: "left" | "right";
  label: string;
  onClose: () => void;
  header: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Changes when the content changes, so the panel re-animates. */
  contentKey?: string;
}

/**
 * A side panel on desktop and a draggable bottom sheet on phones. On phones
 * the sheet peeks at about half height so the city stays visible above it.
 */
export function Sheet({ open, side, label, onClose, header, children, footer, contentKey }: SheetProps) {
  const mobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  const dragControls = useDragControls();

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 90 || info.velocity.y > 600) {
      if (expanded) setExpanded(false);
      else onClose();
    } else if (info.offset.y < -60 || info.velocity.y < -500) {
      setExpanded(true);
    }
  };

  const desktopPos = side === "right" ? "right-4 top-[78px] bottom-4" : "left-4 top-[78px] bottom-4";

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key={mobile ? "m" : "d"}
          role="dialog"
          aria-label={label}
          className={
            mobile
              ? "glass-strong pointer-events-auto absolute inset-x-2 bottom-2 z-20 flex flex-col overflow-hidden rounded-[26px]"
              : `glass-strong pointer-events-auto absolute ${desktopPos} z-20 flex w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[26px]`
          }
          style={mobile ? { height: expanded ? "86dvh" : "min(46dvh, 420px)", transition: "height 260ms cubic-bezier(.2,.8,.2,1)" } : undefined}
          initial={mobile ? { y: "105%" } : { x: side === "right" ? 40 : -40, opacity: 0 }}
          animate={mobile ? { y: 0 } : { x: 0, opacity: 1 }}
          exit={mobile ? { y: "105%" } : { x: side === "right" ? 40 : -40, opacity: 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 32 }}
          drag={mobile ? "y" : false}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.08, bottom: 0.6 }}
          dragListener={false}
          dragControls={dragControls}
          dragSnapToOrigin
          onDragEnd={onDragEnd}
        >
          {mobile && (
            <motion.button
              type="button"
              className="mx-auto flex h-6 w-24 shrink-0 cursor-grab touch-none items-center justify-center"
              aria-label={expanded ? "Collapse panel" : "Expand panel"}
              onClick={() => setExpanded(!expanded)}
              onPointerDown={(e) => dragControls.start(e)}
            >
              <span className="h-1.5 w-10 rounded-full bg-black/15" />
            </motion.button>
          )}
          <div className={`flex items-start gap-3 px-5 ${mobile ? "pt-1 pb-3" : "pt-5 pb-3"}`}>
            <div className="min-w-0 flex-1">{header}</div>
            <button type="button" className="icon-btn -mt-1 -mr-2 h-9 w-9 shrink-0" onClick={onClose} aria-label={`Close ${label.toLowerCase()}`}>
              <IconClose size={17} />
            </button>
          </div>
          <motion.div
            key={contentKey}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className="scroll-soft min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2"
          >
            {children}
          </motion.div>
          {footer && <div className="border-t border-black/[0.06] px-4 py-3">{footer}</div>}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
