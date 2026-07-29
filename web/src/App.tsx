import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { Header, type Tab } from "./components/Header";
import { BuilderCanvas } from "./components/BuilderCanvas";
import { Dashboard } from "./components/Dashboard";
import { Landing } from "./components/landing/Landing";

function App() {
  const { isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const [tab, setTab] = useState<Tab>("builder");
  // A manual override so the Header wordmark can return a CONNECTED user to
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

  if (showLanding) {
    return <Landing onEnter={handleEnter} entering={isPending} />;
  }

  return (
    <div className="min-h-screen">
      <Header tab={tab} onTabChange={setTab} onLogoClick={() => setForceLanding(true)} />
      <main key={tab} className="animate-fade-in mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {tab === "builder" ? <BuilderCanvas /> : <Dashboard />}
      </main>
    </div>
  );
}

export default App;
