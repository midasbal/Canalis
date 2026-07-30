import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { Sidebar, SidebarContent, type Tab } from "./components/Sidebar";
import { MenuIcon, CloseIcon } from "./components/ui/icons";
import { BuilderCanvas } from "./components/BuilderCanvas";
import { Dashboard } from "./components/Dashboard";
import { DocsPage } from "./components/docs/DocsPage";
import { Landing } from "./components/landing/Landing";

const TAB_LABELS: Record<Tab, string> = {
  builder: "Builder",
  dashboard: "Flows",
  docs: "Docs",
};

function App() {
  const { isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const [tab, setTab] = useState<Tab>("builder");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // A manual override so the sidebar wordmark can return a CONNECTED user to
  // the landing without disconnecting them. It's the only reason the
  // landing ever shows while isConnected is true; disconnecting always
  // wins regardless (see showLanding below), and this resets itself once
  // the wallet actually disconnects so a later reconnect doesn't get stuck
  // showing the landing behind a stale override.
  const [forceLanding, setForceLanding] = useState(false);

  useEffect(() => {
    if (!isConnected) setForceLanding(false);
  }, [isConnected]);

  // Connection state is the single source of truth: disconnected always
  // means landing (including right after a Disconnect click, and for a
  // fresh visitor with no persisted session), and a returning wallet that
  // wagmi auto-reconnects goes straight to the app, no local "entered"
  // flag to fall out of sync with reality.
  const showLanding = !isConnected || forceLanding;

  function handleEnter() {
    if (isConnected) {
      setForceLanding(false);
      return;
    }
    connect({ connector: connectors[0] });
  }

  function handleTabChange(next: Tab) {
    setTab(next);
    setMobileNavOpen(false);
  }

  function handleLogoClick() {
    setForceLanding(true);
    setMobileNavOpen(false);
  }

  if (showLanding) {
    return <Landing onEnter={handleEnter} entering={isPending} />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-brand-base text-brand-ink">
      <Sidebar tab={tab} onTabChange={handleTabChange} onLogoClick={handleLogoClick} />

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMobileNavOpen(false)}
            className="absolute inset-0 bg-black/60"
          />
          <aside className="relative z-50 flex h-full w-72 max-w-[80vw] flex-col border-r border-brand-bronze/20 bg-brand-base-alt">
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close menu"
              className="absolute top-5 right-3 text-brand-muted hover:text-brand-ink"
            >
              <CloseIcon />
            </button>
            <SidebarContent tab={tab} onTabChange={handleTabChange} onLogoClick={handleLogoClick} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-brand-bronze/15 bg-brand-base/80 px-4 py-3 backdrop-blur-md sm:px-6 md:px-8">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open menu"
            className="text-brand-muted hover:text-brand-ink md:hidden"
          >
            <MenuIcon />
          </button>
          <h1 className="text-sm font-medium text-brand-ink">{TAB_LABELS[tab]}</h1>
          <span className="ml-auto hidden font-mono text-xs text-brand-muted sm:inline">Arc testnet</span>
        </header>

        <main key={tab} className="animate-fade-in flex-1 overflow-y-auto px-4 py-6 sm:px-6 md:px-8 md:py-8">
          {tab === "builder" ? (
            <BuilderCanvas />
          ) : tab === "dashboard" ? (
            <Dashboard onGoToBuilder={() => handleTabChange("builder")} />
          ) : (
            <DocsPage />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
