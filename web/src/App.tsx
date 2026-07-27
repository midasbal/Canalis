import { useState } from "react";
import { Header, type Tab } from "./components/Header";
import { BuilderCanvas } from "./components/BuilderCanvas";
import { Dashboard } from "./components/Dashboard";

function App() {
  const [tab, setTab] = useState<Tab>("builder");

  return (
    <div className="min-h-screen">
      <Header tab={tab} onTabChange={setTab} />
      <main key={tab} className="animate-fade-in mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {tab === "builder" ? <BuilderCanvas /> : <Dashboard />}
      </main>
    </div>
  );
}

export default App;
