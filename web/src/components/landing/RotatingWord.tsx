import { useEffect, useState } from "react";

const PHRASES = ["itself.", "on its own.", "while you sleep.", "on your rules.", "without you."];
const INTERVAL_MS = 2600;
const STATIC_PHRASE = PHRASES[0];

/**
 * Rotates the hero headline's closing phrase ("Money that runs ___.") on a
 * gentle timer. Every phrase is stacked in the same CSS grid cell (all
 * `col-start-1 row-start-1`) so the box always sizes to the widest one
 * (the invisible sizer below) and the line's layout never jumps width or
 * height between phrases, only opacity and a slight vertical slide
 * animate. Respects prefers-reduced-motion by freezing on the first
 * phrase with no rotation and no timer at all.
 */
export function RotatingWord() {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % PHRASES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, [reducedMotion]);

  if (reducedMotion) {
    return <span className="text-brand-violet">{STATIC_PHRASE}</span>;
  }

  return (
    <span className="relative inline-grid text-left align-bottom">
      {PHRASES.map((phrase, i) => (
        <span
          key={phrase}
          aria-hidden={i !== index}
          className={`col-start-1 row-start-1 text-nowrap text-brand-violet transition-all duration-700 ease-out ${
            i === index ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-1.5 opacity-0"
          }`}
        >
          {phrase}
        </span>
      ))}
      {/* Invisible sizer matching the widest phrase, so the grid cell (and therefore the whole line) never shrinks below it. */}
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 text-nowrap">
        while you sleep.
      </span>
    </span>
  );
}
