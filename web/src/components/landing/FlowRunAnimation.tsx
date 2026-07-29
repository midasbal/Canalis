import { useReducedMotion } from "./useReducedMotion";

/**
 * "Watch a flow run" — the centerpiece demonstration of "money that runs
 * itself." A single SVG, static channel lines (bronze) plus five CSS
 * -animated pieces sharing one 8s loop (see index.css): a token travels
 * from a starting vault to a condition gate, the gate glows (a live Pyth
 * price check, per the label), the token splits in two once past it, each
 * half travels a branch to its own destination, and a small ping marks
 * arrival. Every animated piece is timed as a slice of the SAME shared
 * 8s keyframe duration, so they stay in lockstep automatically with no
 * JS-driven timing at all.
 *
 * Reduced motion: renders the same SVG with every animated piece frozen
 * in its settled end state (token invisible, both branch tokens at their
 * destinations, both pings mid-fade, gate glow calm) instead of looping,
 * a static "final state" diagram rather than a frame chosen at random by
 * the global animation-duration override.
 */
export function FlowRunAnimation() {
  const reducedMotion = useReducedMotion();

  return (
    <svg viewBox="0 0 420 150" className="w-full max-w-xl" role="img" aria-label="Diagram of a Canalis flow executing automatically">
      {/* Static channel lines */}
      <line x1="34" y1="75" x2="150" y2="75" stroke="var(--color-brand-bronze)" strokeOpacity="0.35" strokeWidth="1.5" />
      <line x1="180" y1="75" x2="210" y2="75" stroke="var(--color-brand-bronze)" strokeOpacity="0.35" strokeWidth="1.5" />
      <line x1="210" y1="75" x2="370" y2="30" stroke="var(--color-brand-bronze)" strokeOpacity="0.35" strokeWidth="1.5" />
      <line x1="210" y1="75" x2="370" y2="120" stroke="var(--color-brand-bronze)" strokeOpacity="0.35" strokeWidth="1.5" />

      {/* Start node */}
      <circle cx="28" cy="75" r="6" fill="var(--color-brand-base-alt)" stroke="var(--color-brand-bronze)" strokeWidth="1.5" />
      <text x="28" y="98" textAnchor="middle" className="fill-brand-muted font-mono text-[9px] uppercase tracking-wide">
        Vault
      </text>

      {/* Condition gate */}
      <g transform="translate(165 75)">
        <circle
          r="15"
          fill="var(--color-brand-violet-soft)"
          opacity={reducedMotion ? 0.35 : undefined}
          className={reducedMotion ? undefined : "animate-flow-gate-glow"}
          style={reducedMotion ? undefined : { transformBox: "fill-box", transformOrigin: "center" }}
        />
        <rect x="-8" y="-8" width="16" height="16" fill="var(--color-brand-base-alt)" stroke="var(--color-brand-bronze)" strokeWidth="1.5" transform="rotate(45)" />
      </g>
      <text x="165" y="112" textAnchor="middle" className="fill-brand-bronze font-mono text-[9px] uppercase tracking-wide">
        Live Pyth check
      </text>

      {/* Destination nodes */}
      <circle cx="374" cy="30" r="6" fill="var(--color-brand-base-alt)" stroke="var(--color-brand-bronze)" strokeWidth="1.5" />
      <text x="374" y="14" textAnchor="middle" className="fill-brand-muted font-mono text-[9px] uppercase tracking-wide">
        EURC
      </text>
      <circle cx="374" cy="120" r="6" fill="var(--color-brand-base-alt)" stroke="var(--color-brand-bronze)" strokeWidth="1.5" />
      <text x="374" y="139" textAnchor="middle" className="fill-brand-muted font-mono text-[9px] uppercase tracking-wide">
        USDC
      </text>

      {/* Destination pings */}
      <circle
        cx="374"
        cy="30"
        r="8"
        fill="none"
        stroke="var(--color-brand-violet)"
        strokeWidth="1.5"
        opacity={reducedMotion ? 0.5 : 0}
        className={reducedMotion ? undefined : "animate-flow-ping"}
        style={reducedMotion ? undefined : { transformBox: "fill-box", transformOrigin: "center" }}
      />
      <circle
        cx="374"
        cy="120"
        r="8"
        fill="none"
        stroke="var(--color-brand-violet)"
        strokeWidth="1.5"
        opacity={reducedMotion ? 0.5 : 0}
        className={reducedMotion ? undefined : "animate-flow-ping"}
        style={reducedMotion ? undefined : { transformBox: "fill-box", transformOrigin: "center" }}
      />

      {/* The value token: one before the gate, two after the split (hidden pre-split, shown here at rest under reduced motion) */}
      <circle cx="28" cy="75" r="4.5" fill="var(--color-brand-violet)" opacity={reducedMotion ? 0 : undefined} className={reducedMotion ? undefined : "animate-flow-token-main"} />
      <circle
        cx="210"
        cy="75"
        r="4.5"
        fill="var(--color-brand-violet)"
        opacity={reducedMotion ? 1 : undefined}
        transform={reducedMotion ? "translate(160 -45)" : undefined}
        className={reducedMotion ? undefined : "animate-flow-token-a"}
      />
      <circle
        cx="210"
        cy="75"
        r="4.5"
        fill="var(--color-brand-violet)"
        opacity={reducedMotion ? 1 : undefined}
        transform={reducedMotion ? "translate(160 45)" : undefined}
        className={reducedMotion ? undefined : "animate-flow-token-b"}
      />
    </svg>
  );
}
