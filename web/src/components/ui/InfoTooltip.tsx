import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface InfoTooltipProps {
  /** Accessible name for the trigger button, e.g. "About Draft with AI". */
  label: string;
  /** The tooltip's plain-English explanation, 1-2 sentences. */
  children: string;
}

const VIEWPORT_MARGIN = 8; // never render closer than this to a screen edge
const TRIGGER_GAP = 8; // gap between the trigger and the popup
const ESTIMATED_HEIGHT = 96; // first-pass guess for the above/below flip decision, refined after mount below

interface Position {
  top: number;
  left: number;
  width: number;
  placement: "above" | "below";
}

function computePosition(triggerRect: DOMRect, assumedHeight: number): Position {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  const width = Math.min(224, viewportWidth - VIEWPORT_MARGIN * 2);

  let left = triggerRect.left;
  if (left + width > viewportWidth - VIEWPORT_MARGIN) left = viewportWidth - VIEWPORT_MARGIN - width;
  if (left < VIEWPORT_MARGIN) left = VIEWPORT_MARGIN;

  const spaceAbove = triggerRect.top;
  const spaceBelow = viewportHeight - triggerRect.bottom;
  // Prefer above (matches the trigger sitting inline with a heading); flip
  // below only when there's genuinely not enough room above, or below has
  // more room to work with (e.g. trigger near the very top of the page).
  const placement: Position["placement"] =
    spaceAbove >= assumedHeight + TRIGGER_GAP || spaceAbove >= spaceBelow ? "above" : "below";

  const top = placement === "above" ? triggerRect.top - TRIGGER_GAP : triggerRect.bottom + TRIGGER_GAP;

  return { top, left, width, placement };
}

/**
 * Small "?" info affordance for section headings. Opens on hover AND
 * keyboard focus (not click-only, so it's usable without a pointer),
 * closes on blur/mouseleave/Escape, and wires aria-describedby so screen
 * readers announce the explanation alongside the trigger.
 *
 * The popup renders in a portal to document.body instead of inline, so it
 * always floats above every card/section regardless of the trigger's own
 * stacking context or any ancestor's `overflow`. Position is measured from
 * the trigger (getBoundingClientRect, viewport-relative, which lines up
 * exactly with the popup's own `position: fixed`) and clamped so it never
 * clips at the top, bottom, or sides of the screen: a first pass picks
 * above/below from an estimated height, then a layout effect re-measures
 * the actually-rendered popup and corrects the placement before paint if
 * the estimate was off, so there's no visible flicker.
 */
export function InfoTooltip({ label, children }: InfoTooltipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Position | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }

    function reposition(assumedHeight: number) {
      const trigger = triggerRef.current;
      if (!trigger) return;
      setPos(computePosition(trigger.getBoundingClientRect(), assumedHeight));
    }

    reposition(ESTIMATED_HEIGHT);

    const handleReflow = () => reposition(tooltipRef.current?.getBoundingClientRect().height ?? ESTIMATED_HEIGHT);
    window.addEventListener("resize", handleReflow);
    window.addEventListener("scroll", handleReflow, true);
    return () => {
      window.removeEventListener("resize", handleReflow);
      window.removeEventListener("scroll", handleReflow, true);
    };
  }, [open]);

  // Second pass: now that the popup has actually rendered, use its real
  // height (not the estimate) to correct the above/below flip if needed.
  useLayoutEffect(() => {
    if (!open || !pos || !tooltipRef.current || !triggerRef.current) return;
    const actualHeight = tooltipRef.current.getBoundingClientRect().height;
    const corrected = computePosition(triggerRef.current.getBoundingClientRect(), actualHeight);
    if (corrected.placement !== pos.placement || Math.round(corrected.top) !== Math.round(pos.top)) {
      setPos(corrected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pos?.placement, pos?.top]);

  return (
    <span className="relative inline-flex">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-brand-bronze/30 text-[10px] leading-none font-medium text-brand-muted transition-colors duration-200 hover:border-brand-violet/50 hover:text-brand-ink focus-visible:border-brand-violet/50 focus-visible:text-brand-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-violet/50"
      >
        ?
      </button>
      {open &&
        pos &&
        createPortal(
          <span
            ref={tooltipRef}
            role="tooltip"
            id={tooltipId}
            style={{
              position: "fixed",
              top: pos.top,
              left: pos.left,
              width: pos.width,
              transform: pos.placement === "above" ? "translateY(-100%)" : undefined,
            }}
            className="pointer-events-none z-[1000] rounded-lg border border-brand-bronze/20 bg-brand-base-alt px-3 py-2 text-xs leading-snug font-normal normal-case tracking-normal text-brand-muted shadow-lg shadow-black/30"
          >
            {children}
          </span>,
          document.body,
        )}
    </span>
  );
}
