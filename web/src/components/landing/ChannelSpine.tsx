import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

/**
 * The single continuous vertical "conduit" running down the whole landing
 * page (Landing.tsx renders this once, absolutely positioned inside its
 * relative wrapper, so it spans the full stacked height of every
 * section). A violet fill tracks scroll position, from empty at the top
 * of the page to full once the reader reaches the bottom, so the flow
 * visually "carries" them down. Small bronze branch ticks mark where each
 * section begins, echoing an aqueduct's side channels, one per element
 * carrying `data-spine-node` (see Reveal.tsx's `branch` prop).
 *
 * Reduced motion: the bronze line and branch ticks still render (they're
 * static, not animation), but the scroll listener never runs and the
 * violet fill never appears, per "spine static" under reduced motion.
 */
export function ChannelSpine() {
  const reducedMotion = useReducedMotion();
  const fillRef = useRef<HTMLDivElement>(null);
  const [branchOffsets, setBranchOffsets] = useState<number[]>([]);

  useEffect(() => {
    if (reducedMotion) return;

    let ticking = false;
    function updateFill() {
      ticking = false;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      const progress = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0;
      if (fillRef.current) fillRef.current.style.height = `${progress * 100}%`;
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(updateFill);
    }

    updateFill();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [reducedMotion]);

  useEffect(() => {
    function measure() {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-spine-node]"));
      setBranchOffsets(nodes.map((n) => n.getBoundingClientRect().top + window.scrollY));
    }
    // A couple of animation frames out so layout (fonts, images) has
    // settled before measuring — an early measure would read stale
    // (pre-layout) offsets.
    const id = requestAnimationFrame(() => requestAnimationFrame(measure));
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("resize", measure);
    };
  }, []);

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 w-px sm:left-8 lg:left-12">
      <div className="absolute inset-0 bg-brand-bronze/25" />

      {!reducedMotion && (
        <div
          ref={fillRef}
          className="absolute top-0 left-0 w-px bg-gradient-to-b from-brand-violet-soft via-brand-violet to-brand-violet/80 transition-[height] duration-150 ease-out"
          style={{ height: 0 }}
        />
      )}

      {branchOffsets.map((top, i) => (
        <div key={i} className="absolute h-px w-5 bg-brand-bronze/40 sm:w-6" style={{ top }} />
      ))}

      {/* A quiet pool where the channel gathers at the very end of the page, into the closing CTA. */}
      <div
        className="absolute bottom-0 left-1/2 h-16 w-16 -translate-x-1/2 translate-y-1/2 rounded-full opacity-50 blur-2xl"
        style={{ backgroundColor: "var(--color-brand-violet-soft)" }}
      />
    </div>
  );
}
