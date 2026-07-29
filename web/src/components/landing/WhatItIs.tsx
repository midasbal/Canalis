import { FlowDiagram } from "./FlowDiagram";
import { ChannelLine } from "./ChannelLine";
import { FlowRunAnimation } from "./FlowRunAnimation";
import { LivePriceBadge } from "./LivePriceBadge";

const EXAMPLES = ['"When my paycheck arrives, split it 70/30."', '"Every week, if the euro dips, convert USDC to EURC."'];

/** Plain explanation of the trigger → condition → action model, id'd for the hero's "How it works" anchor link. */
export function WhatItIs() {
  return (
    <section id="how-it-works" className="mx-auto max-w-5xl px-5 py-24 sm:px-8 sm:py-32">
      <div className="mx-auto mb-16 flex max-w-2xl flex-col items-center gap-6 text-center">
        <ChannelLine className="w-16 opacity-70" />
        <p className="font-display text-xl leading-snug text-brand-ink/90 italic sm:text-2xl">
          The Romans built channels so water flowed on its own. Canalis builds them for your money.
        </p>
      </div>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-16">
        <div>
          <p className="font-mono text-xs tracking-[0.16em] text-brand-bronze uppercase">What it is</p>
          <h2 className="mt-3 font-display text-3xl leading-tight font-medium text-brand-ink sm:text-4xl">
            A flow is a rule, written once.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-brand-muted">
            Every Canalis flow is a chain of <span className="text-brand-ink">trigger → condition → action</span>.
            Compose it from blocks, deploy it to your own on-chain vault, and it runs itself from then on. No
            Solidity, no manual transactions, no watching a dashboard.
          </p>

          <ul className="mt-6 flex flex-col gap-3">
            {EXAMPLES.map((example) => (
              <li
                key={example}
                className="rounded-xl border border-brand-bronze/20 bg-brand-surface/50 px-4 py-3 font-mono text-sm text-brand-ink/90"
              >
                {example}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center rounded-2xl border border-brand-bronze/20 bg-brand-surface/40 p-8 sm:p-10">
          <FlowDiagram />
        </div>
      </div>

      <div className="mt-20 flex flex-col items-center gap-6 rounded-2xl border border-brand-bronze/20 bg-brand-surface/30 p-8 text-center sm:p-12">
        <p className="font-mono text-xs tracking-[0.16em] text-brand-bronze uppercase">Watch a flow run</p>
        <FlowRunAnimation />
        <LivePriceBadge />
      </div>
    </section>
  );
}
