import { useState } from "react";
import { useReducedMotion } from "./useReducedMotion";

const MOTE_COUNT = 20;

interface Mote {
  left: number;
  top: number;
  size: number;
  opacity: number;
  dx: number;
  dy: number;
  duration: number;
  delay: number;
}

/**
 * A handful of very faint, slowly drifting motes scattered down the page,
 * like dust suspended in still light. Deliberately few (20) and
 * low-opacity so this reads as ambience, not a particle background.
 * Positions/timings are generated once (useState initializer, not
 * re-rolled on every render) and animated purely via CSS transform
 * (`animate-mote-drift`, index.css), so the ongoing cost is a handful of
 * GPU-composited transforms, nothing per-frame in JS.
 *
 * `absolute inset-0` inside Landing's relative wrapper (same technique as
 * ChannelSpine/GrainOverlay) so motes are scattered across the whole
 * document height. Reduced motion: renders nothing at all.
 */
export function AmbientMotes() {
  const reducedMotion = useReducedMotion();
  const [motes] = useState<Mote[]>(() =>
    Array.from({ length: MOTE_COUNT }, () => ({
      left: Math.random() * 100,
      top: Math.random() * 100,
      size: 1.5 + Math.random() * 2,
      opacity: 0.08 + Math.random() * 0.16,
      dx: (Math.random() - 0.5) * 40,
      dy: (Math.random() - 0.5) * 40,
      duration: 28 + Math.random() * 24,
      delay: -Math.random() * 30,
    })),
  );

  if (reducedMotion) return null;

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {motes.map((mote, i) => (
        <span
          key={i}
          className="animate-mote-drift absolute rounded-full bg-brand-violet-soft blur-[0.5px]"
          style={{
            left: `${mote.left}%`,
            top: `${mote.top}%`,
            width: mote.size,
            height: mote.size,
            opacity: mote.opacity,
            animationDuration: `${mote.duration}s`,
            animationDelay: `${mote.delay}s`,
            ["--mote-dx" as string]: `${mote.dx}px`,
            ["--mote-dy" as string]: `${mote.dy}px`,
          }}
        />
      ))}
    </div>
  );
}
