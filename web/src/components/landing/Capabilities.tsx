import { BridgeIcon, KeeperIcon, LanguageIcon, OracleIcon, TestedIcon, VaultIcon } from "./icons";
import { ChannelLine } from "./ChannelLine";

const CAPABILITIES = [
  {
    icon: KeeperIcon,
    title: "Autonomous keeper",
    body: "An off-chain keeper pokes your due flows so they run themselves, with no human in the loop. It never decides anything on your behalf; the contract re-checks the real condition every time.",
  },
  {
    icon: OracleIcon,
    title: "Live oracle conditions",
    body: "Gate a flow on a real, live Pyth market price, not synthetic testnet data. \"Swap when EUR/USD drops below X\" reads the actual price.",
  },
  {
    icon: BridgeIcon,
    title: "Cross-chain settlement",
    body: "A Bridge action burns USDC on Arc via Circle's real CCTP V2 and mints it on Ethereum Sepolia. Proven with a full round trip, not just a burn.",
  },
  {
    icon: LanguageIcon,
    title: "Natural-language builder",
    body: "Describe a flow in plain English and an LLM drafts it into the composer for you to review. It never deploys anything on its own.",
  },
  {
    icon: VaultIcon,
    title: "Self-custody vaults",
    body: "Your funds live in your own on-chain account. Only the rules you deploy, re-verified on every run, can move them.",
  },
  {
    icon: TestedIcon,
    title: "Tested, not just claimed",
    body: "200 Foundry tests (17 fuzz), every contract verified on the Arc explorer, and an open security write-up. Thoroughly tested, not professionally audited.",
  },
];

/** Honest capability grid — every claim here maps to something real and shipped; see SECURITY.md for the exact caveats. */
export function Capabilities() {
  return (
    <section className="border-y border-brand-bronze/15 bg-brand-base-alt/60">
      <div className="mx-auto max-w-5xl px-5 py-24 sm:px-8 sm:py-32">
        <p className="font-mono text-xs tracking-[0.16em] text-brand-bronze uppercase">Capabilities</p>
        <h2 className="mt-3 max-w-2xl font-display text-3xl leading-tight font-medium text-brand-ink sm:text-4xl">
          Real infrastructure, not a demo veneer.
        </h2>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-brand-bronze/15 bg-brand-bronze/15 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex flex-col gap-3 bg-brand-base-alt p-6">
              <span className="text-brand-bronze">
                <Icon />
              </span>
              <h3 className="text-base font-semibold text-brand-ink">{title}</h3>
              <p className="text-sm leading-relaxed text-brand-muted">{body}</p>
            </div>
          ))}
        </div>

        <ChannelLine className="mt-12 opacity-70" />
      </div>
    </section>
  );
}
