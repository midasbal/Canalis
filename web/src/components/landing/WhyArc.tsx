const POINTS = [
  { label: "USDC as gas", body: "No separate gas token to hold or reason about. The money moving is the money paying for it." },
  { label: "Sub-second finality", body: "A flow's execution and its confirmation are effectively simultaneous." },
  { label: "Stablecoin-native", body: "Built around Circle's own stack, not bolted onto a general-purpose chain." },
];

/** Short, optional "why this chain" section — kept brief on purpose. */
export function WhyArc() {
  return (
    <section className="mx-auto max-w-5xl px-5 py-24 sm:px-8 sm:py-32">
      <p className="font-mono text-xs tracking-[0.16em] text-brand-bronze uppercase">Why Arc</p>
      <h2 className="mt-3 max-w-2xl font-display text-3xl leading-tight font-medium text-brand-ink sm:text-4xl">
        Built for money that moves itself.
      </h2>

      <div className="mt-10 grid gap-8 sm:grid-cols-3">
        {POINTS.map((point) => (
          <div key={point.label} className="border-l border-brand-bronze/30 pl-5">
            <h3 className="text-sm font-semibold tracking-wide text-brand-ink uppercase">{point.label}</h3>
            <p className="mt-2 text-sm leading-relaxed text-brand-muted">{point.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
