import { Logo } from "../ui/Logo";
import { ChannelLine } from "./ChannelLine";

interface LandingFooterProps {
  onEnter: () => void;
  entering: boolean;
}

const REPO = "https://github.com/midasbal/Canalis";

/** Closing CTA + footer — the last thing a visitor sees before they either enter the app or leave. */
export function LandingFooter({ onEnter, entering }: LandingFooterProps) {
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

      <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-5 py-8 text-sm text-brand-muted sm:flex-row sm:justify-between sm:px-8">
        <div className="flex items-center gap-2">
          <Logo className="h-5 w-5" />
          <span className="text-brand-ink">Canalis</span>
          <span className="font-mono text-xs text-brand-muted">· Arc testnet</span>
        </div>

        <nav className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
          <a href={REPO} target="_blank" rel="noreferrer" className="transition-colors duration-200 hover:text-brand-ink">
            GitHub
          </a>
          <a href={`${REPO}/blob/main/ROADMAP.md`} target="_blank" rel="noreferrer" className="transition-colors duration-200 hover:text-brand-ink">
            Roadmap
          </a>
          <a href={`${REPO}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer" className="transition-colors duration-200 hover:text-brand-ink">
            Security
          </a>
        </nav>
      </div>
    </footer>
  );
}
