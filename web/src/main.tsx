import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import "./index.css";
import App from "./App.tsx";
import { wagmiConfig } from "./wagmi";
import { ToastProvider } from "./components/ui/ToastProvider";

// The RPC transport (lib/rateLimitedTransport.ts) already retries
// rate-limited/timed-out reads with backoff — keep react-query's own retry
// small so a genuinely failed read still reaches an ERROR state promptly
// instead of two retry layers compounding into a long hang.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
);
