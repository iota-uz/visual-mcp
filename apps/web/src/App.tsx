import { useConvexAuth, useMutation } from "convex/react";
import { type ReactNode, useEffect } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { SignInButton, useGoogleAuth } from "./auth";
import { CanvasPage } from "./routes/Canvas";
import { HomePage } from "./routes/Home";
import { PublicCanvasPage } from "./routes/PublicCanvas";
import { TokensPage } from "./routes/Tokens";
import { WorkspacePage } from "./routes/Workspace";

// Runs once per sign-in: creates (or reconciles) the `users` row this
// identity maps to. Every other query/mutation assumes that row already
// exists, so this has to land before any of them fire.
function EnsureUser({ children }: { children: ReactNode }) {
  const ensureUser = useMutation(api.users.ensureUser);
  const { isAuthenticated } = useConvexAuth();

  useEffect(() => {
    if (isAuthenticated) {
      ensureUser({}).catch((err: unknown) => {
        console.error("ensureUser failed", err);
      });
    }
  }, [isAuthenticated, ensureUser]);

  return <>{children}</>;
}

function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { identity } = useGoogleAuth();

  if (isLoading) {
    return (
      <div className="centered-page">
        <p>Loading…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="centered-page">
        <h1>Visual Canvas</h1>
        <p>Sign in with your @iota.uz Google account to continue.</p>
        <SignInButton />
        {identity && identity.hd !== "iota.uz" && (
          <p className="error-text">
            Signed in as {identity.email}, which is not an @iota.uz account.
          </p>
        )}
      </div>
    );
  }

  return <EnsureUser>{children}</EnsureUser>;
}

function Nav() {
  return (
    <header className="app-nav">
      <Link to="/" className="app-nav-brand">
        Visual Canvas
      </Link>
      <Link to="/settings/tokens">MCP tokens</Link>
    </header>
  );
}

// `/s/:slug` is deliberately outside <AuthGate> — it's the anonymous,
// no-login public-share route (PLAN.md Part 1 section 1/8, decision #4).
// Every other route requires a signed-in @iota.uz session.
export function App() {
  return (
    <Routes>
      <Route path="/s/:slug" element={<PublicCanvasPage />} />
      <Route
        path="*"
        element={
          <AuthGate>
            <Nav />
            <main className="app-main">
              <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/w/:wsSlug" element={<WorkspacePage />} />
                <Route path="/c/:canvasId" element={<CanvasPage />} />
                <Route path="/settings/tokens" element={<TokensPage />} />
              </Routes>
            </main>
          </AuthGate>
        }
      />
    </Routes>
  );
}
