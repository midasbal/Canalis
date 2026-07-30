import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { ChannelLine } from "../landing/ChannelLine";
import { FlowDiagram } from "../landing/FlowDiagram";
import { ChevronIcon } from "../ui/icons";
import { ACTION_ICONS, CONDITION_ICONS, TRIGGER_ICONS } from "../ui/blockIcons";
import { ACTION_KIND_LABELS, CONDITION_KIND_LABELS, type ConditionKind } from "../../lib/composer";
import { ActionType, TriggerType } from "../../lib/flows";
import { triggerTypeLabel } from "../../lib/flowSummary";

/**
 * The in-app Docs tab: a friendly explainer for judges and first-time
 * users, not exhaustive technical documentation (that's the repo's
 * README/ROADMAP/SECURITY.md). Reuses the exact same channel motif and
 * block icons the Builder and landing already use, so a trigger/condition/
 * action reads identically everywhere in the app. Presentation only, no
 * reads or writes of its own.
 */
export function DocsPage() {
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-16 pb-6">
      <header className="flex flex-col items-center gap-4 text-center">
        <ChannelLine className="w-16 opacity-70" />
        <div>
          <p className="font-mono text-xs tracking-[0.16em] text-brand-bronze uppercase">Docs</p>
          <h1 className="mt-2 font-display text-3xl font-medium text-brand-ink sm:text-4xl">
            How{" "}
            <span className="relative inline-block px-1">
              <CanalisEngraving />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute -inset-x-2 -inset-y-3 z-[1]"
                style={{
                  background:
                    "radial-gradient(ellipse 65% 75% at 50% 50%, color-mix(in oklab, var(--color-brand-base) 60%, transparent) 0%, transparent 72%)",
                }}
              />
              <span className="relative z-10">Canalis</span>
            </span>{" "}
            works
          </h1>
        </div>
        <p className="max-w-prose text-sm leading-relaxed text-brand-muted sm:text-base">
          A plain-language explainer, not the full code story. For that, see the repo's README, ROADMAP, and
          SECURITY.md.
        </p>
      </header>

      <Section eyebrow="What it is" title="Programmable money, on your terms">
        <p className="max-w-prose text-sm leading-relaxed text-brand-muted sm:text-base">
          Canalis lets you write a rule for your USDC once, deploy it to your own on-chain vault on Arc, and let it
          run itself from then on: routing, splitting, sweeping, swapping, and settling money exactly the way you
          described it, without you sending another transaction by hand.
        </p>
      </Section>

      <Section eyebrow="The model" title="A flow is trigger → condition → action">
        <p className="max-w-prose text-sm leading-relaxed text-brand-muted sm:text-base">
          Every flow reads left to right, like water down a channel. A <span className="text-brand-ink">trigger</span>{" "}
          is the source, the moment that starts things moving: a manual click, a schedule, an incoming payment, or a
          balance crossing a threshold. <span className="text-brand-ink">Conditions</span> are the gates in between;
          the flow only keeps moving if every gate lets it through. <span className="text-brand-ink">Actions</span>{" "}
          are the outlets at the end, where the money actually goes and what happens to it. Compose a chain of these
          on the canvas and it becomes a real, deployable rule.
        </p>
        <div className="mt-8 rounded-2xl border border-brand-bronze/15 bg-brand-surface/30 p-6 sm:p-10">
          <FlowDiagram />
        </div>
      </Section>

      <Section eyebrow="Get started" title="Build and deploy a flow">
        <ol className="flex flex-col gap-3">
          {WALKTHROUGH.map((step, i) => (
            <li
              key={step.title}
              className="flex gap-4 rounded-xl border border-brand-bronze/15 bg-brand-surface/40 p-4 sm:p-5"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-brand-bronze/30 font-mono text-xs text-brand-bronze">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand-ink">{step.title}</p>
                <p className="mt-1 max-w-prose text-sm leading-relaxed text-brand-muted">{step.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section eyebrow="Reference" title="The building blocks">
        <p className="max-w-prose text-sm leading-relaxed text-brand-muted sm:text-base">
          A compact reference of every block available on the canvas today.
        </p>
        <div className="mt-6 flex flex-col gap-8">
          <BlockGroup title="Triggers" items={TRIGGER_BLOCKS} />
          <BlockGroup title="Conditions" items={CONDITION_BLOCKS} />
          <BlockGroup title="Actions" items={ACTION_BLOCKS} />
        </div>
      </Section>

      <Section eyebrow="Good to know" title="Testnet vs. mainnet, honestly">
        <ul className="flex flex-col gap-3">
          {HONEST_NOTES.map((note) => (
            <li
              key={note.title}
              className="flex gap-3 rounded-xl border border-brand-bronze/15 bg-brand-surface/30 p-4 sm:p-5"
            >
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-bronze" aria-hidden="true" />
              <p className="max-w-prose text-sm leading-relaxed text-brand-muted">
                <span className="font-medium text-brand-ink">{note.title}. </span>
                {note.body}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section eyebrow="FAQ" title="Common questions">
        <div className="flex flex-col gap-2">
          {FAQS.map((faq) => (
            <FaqItem key={faq.q} q={faq.q} a={faq.a} />
          ))}
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------
// Heading engraving
// ---------------------------------------------------------------------

/**
 * A dense, tiled bronze arcade (rows of small repeating aqueduct arches,
 * the app's own motif) filling a soft-edged elliptical panel behind the
 * word "Canalis" in the page heading — engraved gold leaf / a guilloché
 * certificate, not a handful of loose strokes. Quality here comes from
 * density and regularity: an SVG <pattern> tile repeated across a rect
 * (cheap and static, not thousands of individual nodes), masked by a
 * radial gradient so it fades softly at the edges instead of ending in a
 * hard rectangle. A soft dark radial scrim (see the header markup, between
 * this and the word) knocks the pattern back directly behind the letters
 * so "Canalis" stays crisp on top, while the surrounding halo reads full
 * strength. Positioned with an explicit, non-negative z-index (z-0, below
 * the scrim's z-1 and the word's own z-10) rather than a negative one: a
 * negative z-index can fall behind an ancestor's own opaque background and
 * disappear entirely, which is exactly what happened before. Pure static
 * SVG, no motion, so it's reduced-motion-safe by construction.
 */
function CanalisEngraving() {
  return (
    <svg
      viewBox="0 0 240 96"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="pointer-events-none absolute -inset-x-3 -inset-y-2 z-0 text-brand-bronze sm:-inset-x-4 sm:-inset-y-3"
    >
      <defs>
        <pattern id="canalis-arcade" width="16" height="16" patternUnits="userSpaceOnUse">
          <path d="M0 8 L0 1.5 A6.5 6.5 0 0 1 13 1.5 L13 8" fill="none" stroke="currentColor" strokeWidth="1.1" />
          <path d="M-3 15 L-3 8.5 A6.5 6.5 0 0 1 10 8.5 L10 15" fill="none" stroke="currentColor" strokeWidth="1.1" />
        </pattern>
        <radialGradient id="canalis-fade" cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="55%" stopColor="#fff" stopOpacity="1" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="canalis-fade-mask">
          <rect width="240" height="96" fill="url(#canalis-fade)" />
        </mask>
      </defs>
      <rect width="240" height="96" fill="url(#canalis-arcade)" opacity="0.55" mask="url(#canalis-fade-mask)" />
    </svg>
  );
}

// ---------------------------------------------------------------------
// Section shell
// ---------------------------------------------------------------------

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <p className="font-mono text-xs tracking-[0.16em] text-brand-bronze uppercase">{eyebrow}</p>
        <h2 className="mt-2 font-display text-2xl font-medium text-brand-ink sm:text-3xl">{title}</h2>
      </div>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------
// Get started walkthrough
// ---------------------------------------------------------------------

const WALKTHROUGH: { title: string; detail: string }[] = [
  { title: "Connect a wallet", detail: "Use the sidebar's connect button. Canalis runs on Arc testnet." },
  {
    title: "Fund your vault",
    detail:
      "Create your CanalisAccount (one click, if you don't have one yet), then deposit USDC into it from the Flows tab.",
  },
  {
    title: "Compose the flow on the canvas",
    detail: "In Builder, pick a trigger, add any conditions, then add one or more actions. Blocks chain left to right.",
  },
  {
    title: "Check the preview",
    detail: "The \"What this will do\" panel reads your draft back in plain English before anything is deployed.",
  },
  {
    title: "Deploy it to your vault",
    detail: "One signed transaction registers the flow on-chain, owned by your vault, controlled by you.",
  },
  {
    title: "Run it, or let it run itself",
    detail:
      "Use Run now any time. Scheduled and threshold flows can also fire on their own, triggered by an off-chain keeper once they're due.",
  },
];

// ---------------------------------------------------------------------
// Building-block reference
// ---------------------------------------------------------------------

interface BlockRef {
  key: string;
  label: string;
  description: string;
  icon: ComponentType;
}

const TRIGGER_ORDER: TriggerType[] = [TriggerType.Manual, TriggerType.OnSchedule, TriggerType.OnReceive, TriggerType.OnThreshold];

const TRIGGER_DESCRIPTIONS: Record<TriggerType, string> = {
  [TriggerType.Manual]: "Runs only when you click Run now.",
  [TriggerType.OnSchedule]: "Runs once, or repeatedly on an interval, starting at a time you set.",
  [TriggerType.OnReceive]: "Runs when a deposit lands in your vault.",
  [TriggerType.OnThreshold]: "Runs once your vault's balance reaches an amount you set.",
};

const TRIGGER_BLOCKS: BlockRef[] = TRIGGER_ORDER.map((kind) => ({
  key: String(kind),
  label: triggerTypeLabel(kind),
  description: TRIGGER_DESCRIPTIONS[kind],
  icon: TRIGGER_ICONS[kind],
}));

const CONDITION_ORDER: ConditionKind[] = ["amountCap", "minBalance", "cooldown", "timeWindow", "allowList", "denyList", "oraclePrice"];

const CONDITION_DESCRIPTIONS: Record<ConditionKind, string> = {
  amountCap: "Only lets the action through if the amount falls within a min/max range you set.",
  minBalance: "Only lets the action through if the vault still holds at least this much afterward.",
  cooldown: "Blocks repeat runs until a set amount of time has passed since the last one.",
  timeWindow: "Only lets the action through inside a start/end time window you set.",
  allowList: "Only lets the action pay out to recipient addresses on a list you set.",
  denyList: "Blocks the action from paying out to recipient addresses on a list you set.",
  oraclePrice: "Only lets the action through when a live Pyth price is above or below a threshold you set.",
};

const CONDITION_BLOCKS: BlockRef[] = CONDITION_ORDER.map((kind) => ({
  key: kind,
  label: CONDITION_KIND_LABELS[kind],
  description: CONDITION_DESCRIPTIONS[kind],
  icon: CONDITION_ICONS[kind],
}));

const ACTION_ORDER: ActionType[] = [
  ActionType.Forward,
  ActionType.Split,
  ActionType.Sweep,
  ActionType.LockRelease,
  ActionType.Swap,
  ActionType.Bridge,
];

const ACTION_DESCRIPTIONS: Record<ActionType, string> = {
  [ActionType.Forward]: "Sends the full amount to one recipient.",
  [ActionType.Split]: "Divides the amount across multiple recipients by percentage.",
  [ActionType.Sweep]: "Sends your vault's entire balance to one destination.",
  [ActionType.LockRelease]: "Locks funds until a set time, then releases them to a recipient.",
  [ActionType.Swap]: "Trades USDC for EURC, or back, through Canalis's own on-chain pool.",
  [ActionType.Bridge]: "Sends USDC to another chain via Circle's CCTP bridge.",
};

const ACTION_BLOCKS: BlockRef[] = ACTION_ORDER.map((kind) => ({
  key: String(kind),
  label: ACTION_KIND_LABELS[kind],
  description: ACTION_DESCRIPTIONS[kind],
  icon: ACTION_ICONS[kind],
}));

function BlockGroup({ title, items }: { title: string; items: BlockRef[] }) {
  return (
    <div>
      <p className="mb-3 text-xs font-medium tracking-wide text-brand-muted/70 uppercase">{title}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map(({ key, label, description, icon: Icon }) => (
          <div key={key} className="flex flex-col gap-2 rounded-xl border border-brand-bronze/15 bg-brand-surface/40 p-3.5">
            <span className="text-brand-bronze">
              <Icon />
            </span>
            <p className="text-sm font-medium text-brand-ink">{label}</p>
            <p className="text-xs leading-snug text-brand-muted">{description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Honest notes
// ---------------------------------------------------------------------

const HONEST_NOTES: { title: string; body: string }[] = [
  {
    title: "Swap liquidity is limited on testnet",
    body: "The swap pool is a small, self-owned Arc testnet AMM, seeded with a modest amount of USDC and EURC. Large or repeated swaps can exceed its liquidity and revert. On mainnet, a Swap action would route through deep, real liquidity instead.",
  },
  {
    title: "Autonomy runs through an operator-run keeper",
    body: "Scheduled and threshold flows are triggered by a keeper we operate, an off-chain watcher that calls them once they're due. The chain doesn't care who calls it; the flow's own on-chain rule always decides whether it actually executes.",
  },
  {
    title: "Your funds stay in your own vault",
    body: "Every CanalisAccount is deployed to, and owned by, your wallet address. Canalis never custodies funds; only the CanalisExecutor contract can move money out of it, and only by running a flow you deployed.",
  },
  {
    title: "The contracts are verified and thoroughly tested",
    body: "Every deployed contract is verified on Arc's block explorer and covered by 200+ Foundry tests, including fuzz tests. That's real coverage, not a formality.",
  },
];

// ---------------------------------------------------------------------
// FAQ
// ---------------------------------------------------------------------

const FAQS: { q: string; a: string }[] = [
  {
    q: "Who controls my money?",
    a: "You do. Every Canalis account is your own on-chain vault, owned by your wallet address. Nobody else, including us, can move funds out of it directly.",
  },
  {
    q: "Can Canalis move funds without me?",
    a: "No. Funds only move through flows you compose and deploy yourself. Manual flows only run when you click Run now. Scheduled, threshold, and receive-triggered flows can be called by the keeper (or anyone) once they're due, but the caller never changes what happens, only the rule you deployed does.",
  },
  {
    q: "What happens if a condition is not met?",
    a: "The flow simply does not run. Nothing partially executes and nothing is forced through; it waits until its conditions are actually true.",
  },
  {
    q: "Is this on mainnet?",
    a: "Not yet. Canalis runs on Arc testnet today, built for the Programmable Money Hackathon: Build on Arc.",
  },
  {
    q: "What is the keeper?",
    a: "A small off-chain service we operate that watches for due scheduled and threshold flows and calls them on-chain so you don't have to click Run now yourself. It holds no special permission: the same on-chain call is open to anyone, the keeper is just the one reliably making it.",
  },
  {
    q: "Is it audited?",
    a: "No. Canalis is thoroughly tested (200+ Foundry tests, including fuzz tests) and every contract is verified on Arc's block explorer, but that is not the same as a professional audit, and we don't claim it is.",
  },
  {
    q: "Is the AI builder safe?",
    a: "Yes, in the sense that it never acts on its own. It only drafts a flow from a plain-English description for you to review and edit on the canvas; it never invents addresses, and it never deploys anything without you clicking Deploy yourself.",
  },
  {
    q: "Can I stop a flow once it's deployed?",
    a: "Yes. Pause any flow from the Flows tab at any time; a paused flow simply stops being eligible to run until you resume it.",
  },
  {
    q: "What tokens does Canalis support today?",
    a: "USDC is the primary asset every vault holds and moves. EURC is also supported, mainly as the other side of a Swap action, and its balance is shown alongside your USDC.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-xl border border-brand-bronze/15 bg-brand-surface/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
      >
        <span className="text-sm font-medium text-brand-ink">{q}</span>
        <span className={`shrink-0 text-brand-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          <ChevronIcon />
        </span>
      </button>
      {open && <p className="max-w-prose px-4 pb-4 text-sm leading-relaxed text-brand-muted">{a}</p>}
    </div>
  );
}
