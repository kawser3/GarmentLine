import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { configError } from "./lib/env";
import { ConfigErrorPage } from "./components/config-error";
import { dismissBootPreloader } from "./components/preloader";
import { ThemeProvider } from "./components/theme";
import "./index.css";

const root = createRoot(document.getElementById("root")!);

// Bail out before touching the router or the data layer: without a project key every
// request fails, and throwing at module scope renders a blank page whose only clue is a
// minified stack trace.
if (configError) {
  console.error(
    "[blocks-incident] missing configuration:",
    configError.missing.join(", "),
    "| runtime config present:",
    configError.hasRuntimeConfig,
  );
  // Nothing mounts <Preloader/> on this path, so the boot overlay has to be taken away here or
  // it hides the only page that says what is wrong.
  dismissBootPreloader();
  root.render(<ConfigErrorPage {...configError} />);
} else {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, error) => {
          // Never retry an auth failure — it just delays the redirect to /login.
          if (/not authenticated|401|403/i.test((error as Error)?.message ?? "")) return false;
          return count < 2;
        },
        refetchOnWindowFocus: false,
        /*
         * Two minutes. Shorter than the calculator this shell came from, because an incident
         * register IS transactional — someone watching a live P1 should not be reading a
         * five-minute-old status. Still not zero: every mutation invalidates explicitly, so
         * the person making a change sees it immediately regardless.
         */
        staleTime: 2 * 60 * 1000,
      },
    },
  });

  root.render(
    <StrictMode>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </ThemeProvider>
    </StrictMode>,
  );
}
