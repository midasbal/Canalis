import { Footer } from "../Footer";
import { ChannelLine } from "./ChannelLine";

interface LandingFooterProps {
  onEnter: () => void;
  entering: boolean;
  /** Connects the wallet (if needed) and switches straight to the Docs tab, since Docs only exists inside the connected app. */
  onEnterDocs: () => void;
}

/** Closing CTA, then the shared site Footer: the last thing a visitor sees before they either enter the app or leave. */
export function LandingFooter({ onEnter, entering, onEnterDocs }: LandingFooterProps) {
  return (
    <footer className="relative overflow-hidden bg-brand-base-alt">
      <div className="mx-auto max-w-5xl px-5 py-24 text-center sm:px-8 sm:py-32">
        <h2 className="mx-auto max-w-2xl font-display text-3xl leading-tight font-medium text-brand-ink sm:text-4xl">
          Rome's channels ran for centuries with no hand to guide them.
        </h2>
        <h2 className="mt-1 font-display text-3xl leading-tight font-medium text-brand-violet sm:text-4xl">Yours can too.</h2>
        <p className="mx-auto mt-4 max-w-md text-base text-brand-muted">
          Connect a wallet, fund your vault with testnet USDC, and deploy your first rule in minutes.
        </p>
        <button
          onClick={onEnter}
          disabled={entering}
          className="mt-8 rounded-full border border-brand-violet/40 bg-brand-violet/15 px-7 py-3 text-sm font-medium text-brand-ink transition-all duration-300 hover:border-brand-violet/70 hover:bg-brand-violet/25 hover:shadow-[0_0_28px_-6px_var(--color-brand-violet)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {entering ? "Connecting…" : "Enter Canalis"}
        </button>
      </div>

      <ChannelLine className="opacity-60" />

      <Footer onDocsClick={onEnterDocs} />
    </footer>
  );
}
