import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useReducedMotion } from "./useReducedMotion";

interface RevealProps {
  children: ReactNode;
  /** Extra transition-delay in ms, for staggering siblings that reveal together (e.g. a card grid). */
  delay?: number;
  /** Marks this wrapper as a channel-spine branch point (see ChannelSpine, which queries [data-spine-node]). */
  branch?: boolean;
  className?: string;
}

// How far ahead of the section's own top the spine's flow "arrives" and
// triggers the reveal, as a fraction of viewport height. A small lead
// (rather than requiring the flow to touch the exact pixel) so a section
// doesn't sit half-scrolled-past before its content appears.
const EARLY_TRIGGER_FRACTION = 0.22;

/**
 * Ties each section's reveal to the channel spine itself: the trigger
 * condition mirrors ChannelSpine's own scroll-progress -> page-position
 * formula, so a section visibly appears at the moment the spine's violet
 * flow reaches its branch point, not at a generic "scrolled into view"
 * threshold. Paired with a small bronze hairline that draws itself in
 * (scaleX 0 -> 1, like an etching appearing) and a very slight
 * blur-to-sharp on the content, both keyed to the same reveal moment.
 *
 * Keeps the previous IntersectionObserver-based version's 2.5s safety
 * fallback (a purely decorative reveal must never leave a section stuck
 * invisible), now via a plain scroll listener instead of an observer.
 * Reduced motion: content is simply present, no draw-in, no blur, no
 * transition at all.
 */
export function Reveal({ children, delay = 0, branch = false, className = "" }: RevealProps) {
  const reducedMotion = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (reducedMotion || visible) return;
    const el = ref.current;
    if (!el) return;

    let ticking = false;
    function check() {
      ticking = false;
      if (!el) return;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      const elementTop = el.getBoundingClientRect().top + window.scrollY;
      // Mirrors ChannelSpine's progress -> page-position math, so this
      // fires at the same moment the spine's violet fill visually reaches
      // this element, plus a small early lead (see EARLY_TRIGGER_FRACTION).
      const flowPageY = scrollable > 0 ? (window.scrollY / scrollable) * doc.scrollHeight : doc.scrollHeight;
      if (flowPageY + window.innerHeight * EARLY_TRIGGER_FRACTION >= elementTop) {
        setVisible(true);
      }
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(check);
    }

    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    // Safety net: purely decorative, never load-bearing for reading the
    // content underneath, so it must never leave a section permanently
    // invisible (e.g. this effect never getting a scroll event because
    // the page is already shorter than the viewport). Whichever fires
    // first wins; the other is a no-op.
    const fallback = setTimeout(() => setVisible(true), 2500);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      clearTimeout(fallback);
    };
  }, [reducedMotion, visible]);

  const shown = reducedMotion || visible;

  return (
    <div
      ref={ref}
      data-spine-node={branch ? "" : undefined}
      className={`transition-all duration-700 ease-out ${shown ? "translate-y-0 opacity-100 blur-none" : "translate-y-4 opacity-0 blur-sm"} ${className}`}
      style={reducedMotion ? undefined : { transitionDelay: `${delay}ms` }}
    >
      {!reducedMotion && (
        <div
          aria-hidden="true"
          className={`mx-auto mb-8 h-px w-12 origin-center bg-brand-bronze/50 transition-transform duration-700 ease-out ${shown ? "scale-x-100" : "scale-x-0"}`}
          style={{ transitionDelay: `${delay}ms` }}
        />
      )}
      {children}
    </div>
  );
}
