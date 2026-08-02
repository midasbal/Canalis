import { Logo } from "./ui/Logo";

const REPO = "https://github.com/midasbal/Canalis";
const EXECUTOR_EXPLORER_URL = "https://testnet.arcscan.app/address/0x5C5E45cc991DaEc5657F3BDADC3De0Cea2f1E6Cc";

interface FooterProps {
  /** Navigates to the in-app Docs page. Never an external link: the landing wires this to connect-then-switch-tab, the docs page itself wires it to scroll-to-top. */
  onDocsClick: () => void;
  className?: string;
}

const LINK_CLASS =
  "rounded-sm text-brand-muted transition-colors duration-200 hover:text-brand-violet-soft focus-visible:text-brand-violet-soft focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-violet/50";

/**
 * The site-wide footer for Canalis's content-facing pages (landing, docs):
 * wordmark + tagline, a row of trust-signal links, and one honest line
 * about what's actually deployed. Deliberately unstyled at the outer edge
 * (no background, no top border) so each caller can drop it into its own
 * context: the landing wraps it in its own full-bleed footer band below
 * the closing CTA, the docs page wraps it in a plain bordered footer at
 * the end of the content column.
 *
 * The connected app's working pages (Builder/Flows) keep the sidebar
 * instead, which already carries nav and the vault, so this is never
 * rendered there.
 */
export function Footer({ onDocsClick, className = "" }: FooterProps) {
  return (
    <div className={`mx-auto flex w-full max-w-5xl flex-col gap-8 px-5 py-10 sm:px-8 ${className}`}>
      <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Logo className="h-6 w-6" />
            <span className="text-base font-semibold text-brand-ink">Canalis</span>
          </div>
          <p className="max-w-xs text-sm text-brand-muted">Programmable USDC money-flows on Arc.</p>
        </div>

        <nav
          aria-label="Footer"
          className="flex flex-col gap-3 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-7 sm:gap-y-2"
        >
          <a href={REPO} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            GitHub
          </a>
          <button type="button" onClick={onDocsClick} className={`text-left ${LINK_CLASS}`}>
            Docs
          </button>
          <a href={EXECUTOR_EXPLORER_URL} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            Verified contracts
          </a>
          <a href={`${REPO}/blob/main/ROADMAP.md`} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            Roadmap
          </a>
          <a href={`${REPO}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer" className={LINK_CLASS}>
            Security
          </a>
        </nav>
      </div>

      <p className="border-t border-brand-bronze/10 pt-6 text-xs text-brand-muted">
        Built on Arc testnet, Circle's stablecoin L1, for the Programmable Money Hackathon: Build on Arc.
      </p>
    </div>
  );
}
