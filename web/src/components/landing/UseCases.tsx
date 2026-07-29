const USE_CASES = [
  {
    label: "Treasuries",
    body: "When revenue arrives, keep six months of runway in USDC and convert the surplus to EURC.",
  },
  {
    label: "Payroll",
    body: "Every two weeks, pay each contributor their fixed USDC salary, automatically.",
  },
  {
    label: "Set and forget",
    body: "Every week the euro dips below your target, move a little USDC into EURC.",
  },
  {
    label: "Payouts",
    body: "On a schedule, route a fixed payment to a vendor or subscription.",
  },
];

/**
 * Four plain-English flows, one per real-world use case, each a small
 * channel card. On hover or keyboard focus, a small violet token travels
 * once along the card's own channel line (a one-shot "send," not a loop,
 * since hover is a discrete moment) and the card lifts very slightly.
 * Both are quick, subtle CSS transitions, no JS.
 */
export function UseCases() {
  return (
    <section className="mx-auto max-w-5xl px-5 py-24 sm:px-8 sm:py-32">
      <p className="font-mono text-xs tracking-[0.16em] text-brand-bronze uppercase">Use cases</p>
      <h2 className="mt-3 max-w-2xl font-display text-3xl leading-tight font-medium text-brand-ink sm:text-4xl">
        A channel for every kind of money.
      </h2>

      <div className="mt-12 grid gap-6 sm:grid-cols-2">
        {USE_CASES.map((useCase) => (
          <div
            key={useCase.label}
            tabIndex={0}
            className="group rounded-2xl border border-brand-bronze/20 bg-brand-surface/40 p-6 transition-transform duration-300 ease-out hover:-translate-y-1 focus-visible:-translate-y-1 focus-visible:ring-1 focus-visible:ring-brand-violet/50 focus-visible:outline-none"
          >
            <div className="relative mb-4 h-px w-10">
              <div className="absolute inset-0 bg-brand-bronze/40" />
              <div className="absolute top-1/2 left-0 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-brand-violet opacity-0 transition-all duration-500 ease-out group-hover:translate-x-8 group-hover:opacity-100 group-focus-visible:translate-x-8 group-focus-visible:opacity-100" />
            </div>
            <p className="font-mono text-xs tracking-[0.14em] text-brand-bronze uppercase">{useCase.label}</p>
            <p className="mt-3 text-sm leading-relaxed text-brand-ink/90">{useCase.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
