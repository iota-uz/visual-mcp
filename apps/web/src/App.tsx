import { googleLogout } from "@react-oauth/google";
import { useConvexAuth, useMutation } from "convex/react";
import { Blocks, KeyRound, LayoutGrid, LogOut } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { SignInButton, useGoogleAuth } from "./auth";
import { LoadingState } from "./components/LoadingState";
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
        <LoadingState />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="centered-page">
        <h1>Visual Canvas</h1>
        <p>Sign in with your @iota.uz Google account to continue.</p>
        <div className="centered-page-signin">
          <SignInButton />
        </div>
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

function sidebarLinkClass({ isActive }: { isActive: boolean }) {
  return isActive ? "app-sidebar-link active" : "app-sidebar-link";
}

// Left sidebar, not a top bar — a canvas page (below) needs the full
// viewport height for its viewport to feel like Figma/the original osago
// file, and a horizontal nav bar would eat into that on every page.
function Sidebar() {
  const { identity, signOut } = useGoogleAuth();

  function handleSignOut() {
    googleLogout();
    signOut();
  }

  return (
    <aside className="app-sidebar">
      <Link to="/" className="app-sidebar-brand">
        <Blocks size={20} />
        <span>Visual Canvas</span>
      </Link>
      <nav className="app-sidebar-nav">
        <NavLink to="/" end className={sidebarLinkClass}>
          <LayoutGrid size={16} />
          <span>Workspaces</span>
        </NavLink>
        <NavLink to="/settings/tokens" className={sidebarLinkClass}>
          <KeyRound size={16} />
          <span>MCP tokens</span>
        </NavLink>
      </nav>
      <div className="app-sidebar-footer">
        {identity?.email && (
          <span className="app-sidebar-email" title={identity.email}>
            {identity.email}
          </span>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleSignOut}>
          <LogOut size={14} /> <span>Sign out</span>
        </button>
      </div>
    </aside>
  );
}

// `/s/:slug` is deliberately outside <AuthGate> — it's the anonymous,
// no-login public-share route (PLAN.md Part 1 section 1/8, decision #4). It
// gets its own minimal shell (brand only, no nav links, no sign-out) since
// it's the only page anonymous outsiders ever see. Every other route
// requires a signed-in @iota.uz session.
export function App() {
  return (
    <Routes>
      <Route
        path="/s/:slug"
        element={
          <div className="public-shell">
            <header className="public-shell-header">
              <span className="public-shell-brand">Visual Canvas</span>
            </header>
            <PublicCanvasPage />
          </div>
        }
      />
      <Route
        path="*"
        element={
          <AuthGate>
            <div className="app-shell">
              <Sidebar />
              <div className="app-content">
                <Routes>
                  <Route
                    path="/"
                    element={
                      <div className="page-container">
                        <HomePage />
                      </div>
                    }
                  />
                  <Route
                    path="/w/:wsSlug"
                    element={
                      <div className="page-container">
                        <WorkspacePage />
                      </div>
                    }
                  />
                  <Route path="/c/:canvasId" element={<CanvasPage />} />
                  <Route
                    path="/settings/tokens"
                    element={
                      <div className="page-container">
                        <TokensPage />
                      </div>
                    }
                  />
                </Routes>
              </div>
            </div>
          </AuthGate>
        }
      />
    </Routes>
  );
}
