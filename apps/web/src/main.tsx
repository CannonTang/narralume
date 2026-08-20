import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppShell } from "./app/shell";
import { followSystemTheme } from "./app/theme";
import { TrialAccessGate } from "./app/trial-access-gate";

/* 首屏前同步系统主题，并继续监听操作系统的昼夜变化。 */
followSystemTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 10_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TrialAccessGate>
        <AppShell />
      </TrialAccessGate>
    </QueryClientProvider>
  </StrictMode>,
);
