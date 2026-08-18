import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/Toast";
import "./styles/index.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL is not set — see apps/web/.env.example");
}

const convex = new ConvexReactClient(convexUrl);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("index.html is missing #root");

// `ConvexAuthProvider` supplies the auth-aware Convex client itself: it owns
// the access/refresh token pair, refreshes in the background, and persists
// to localStorage across reloads. There is no Google client id in the
// browser any more — the OAuth exchange happens on the Convex deployment,
// which is the only place the client secret exists.
createRoot(rootEl).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <BrowserRouter>
        <ToastProvider>
          <ErrorBoundary>
            <App />
          </ErrorBoundary>
        </ToastProvider>
      </BrowserRouter>
    </ConvexAuthProvider>
  </StrictMode>,
);
