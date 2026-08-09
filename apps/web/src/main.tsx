import { GoogleOAuthProvider } from "@react-oauth/google";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { GoogleAuthProvider, useConvexAuthFromGoogle } from "./auth";
import "./styles.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
if (!convexUrl) {
  throw new Error("VITE_CONVEX_URL is not set — see apps/web/.env.example");
}
const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
if (!googleClientId) {
  throw new Error("VITE_GOOGLE_CLIENT_ID is not set — see apps/web/.env.example");
}

const convex = new ConvexReactClient(convexUrl);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("index.html is missing #root");

createRoot(rootEl).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={googleClientId}>
      <GoogleAuthProvider>
        <ConvexProviderWithAuth client={convex} useAuth={useConvexAuthFromGoogle}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </ConvexProviderWithAuth>
      </GoogleAuthProvider>
    </GoogleOAuthProvider>
  </StrictMode>,
);
