import { Logo } from "./ui/Logo";
import { WalletConnect } from "./WalletConnect";

export type Tab = "builder" | "dashboard";

const TABS: { id: Tab; label: string }[] = [
  { id: "builder", label: "Builder" },
  { id: "dashboard", label: "Dashboard" },
];

interface HeaderProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  /** Returns a connected user to the landing page without disconnecting their wallet. */
  onLogoClick: () => void;
}

export function Header({ tab, onTabChange, onLogoClick }: HeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-border-soft bg-canvas/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:gap-4 sm:py-4 sm:px-6">
        <button
          type="button"
          onClick={onLogoClick}
          className="flex shrink-0 items-center gap-2 rounded-lg transition-opacity duration-200 hover:opacity-80"
          aria-label="Back to the Canalis landing page"
        >
          <Logo className="h-6 w-6 sm:h-7 sm:w-7" />
          <div className="flex items-baseline gap-2">
            <span className="text-base font-semibold tracking-tight text-ink sm:text-lg">Canalis</span>
            <span className="hidden text-xs text-ink-faint md:inline">Arc testnet</span>
          </div>
        </button>

        <nav className="flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface/60 p-1">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => onTabChange(id)}
              className={`whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors duration-200 sm:px-4 sm:text-sm ${
                tab === id ? "bg-accent text-white shadow-sm" : "text-ink-muted hover:text-ink"
              }`}
              aria-current={tab === id}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="shrink-0">
          <WalletConnect />
        </div>
      </div>
    </header>
  );
}
