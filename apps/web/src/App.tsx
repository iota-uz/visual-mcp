import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Blocks, KeyRound, LayoutGrid, LogOut } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { clearSignInAttempt, SignInButton, useSessionUser, useSignOut } from "./auth";
import { EmptyState } from "./components/EmptyState";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoadingState } from "./components/LoadingState";
import { toastError, useToast } from "./components/Toast";
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
  const { notify } = useToast();

  useEffect(() => {
    if (isAuthenticated) {
      // The round trip worked, so a later sign-out must not land on the
      // "sign-in didn't complete" message left by this one.
      clearSignInAttempt();
      // Everything downstream assumes this row exists, so failing silently
      // to the console meant the app looked signed-in and then every query
      // came back empty with no explanation.
      ensureUser({}).catch((err: unknown) => {
        console.error("ensureUser failed", err);
        notify(toastError(err, "Couldn't set up your account"));
      });
    }
  }, [isAuthenticated, ensureUser, notify]);

  return <>{children}</>;
}

function AuthGate({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();

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
          {/* Accounts outside the org are rejected server-side during the
              OAuth exchange, so the "signed in as someone else" state can no
              longer exist here. The refusal comes back as a bare redirect,
              which is why SignInButton reconstructs it from a marker. */}
          <SignInButton />
        </div>
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
  const sessionUser = useSessionUser();
  const signOut = useSignOut();
  // Switching workspaces used to be a three-hop trip: canvas → workspace →
  // home → other workspace. This is the same subscription Home already
  // holds, so the list costs nothing extra.
  const workspaces = useQuery(api.workspaces.listMine, {});

  function handleSignOut() {
    // Ends the Convex session and drops the stored tokens; the Google
    // account itself stays signed in in the browser, which is what a user
    // signing out of one app expects.
    void signOut();
  }

  return (
    <aside className="app-sidebar">
      <Link to="/" className="app-sidebar-brand" aria-label="Visual Canvas — home">
        <Blocks size={20} aria-hidden="true" />
        <span>Visual Canvas</span>
      </Link>
      {/* The labels are display:none on the narrow rail, which drops them
          out of the accessibility tree entirely — hence the aria-labels. */}
      <nav className="app-sidebar-nav">
        <NavLink to="/" end className={sidebarLinkClass} aria-label="Workspaces">
          <LayoutGrid size={16} aria-hidden="true" />
          <span>Workspaces</span>
        </NavLink>
        {workspaces && workspaces.length > 0 && (
          <ul className="app-sidebar-workspaces">
            {workspaces.map((w) => (
              <li key={w.workspace_id}>
                <NavLink to={`/w/${w.slug}`} className={sidebarLinkClass} title={w.name}>
                  <span>{w.name}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        )}
        <NavLink to="/settings/tokens" className={sidebarLinkClass} aria-label="MCP tokens">
          <KeyRound size={16} aria-hidden="true" />
          <span>MCP tokens</span>
        </NavLink>
      </nav>
      <div className="app-sidebar-footer">
        {sessionUser?.email && (
          <span className="app-sidebar-email" title={sessionUser.email}>
            {sessionUser.email}
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
              <a href="#main" className="skip-link">
                Skip to content
              </a>
              <Sidebar />
              {/* tabIndex -1: without it the skip link moves the viewport
                  but not focus in Safari and Chrome, so the next Tab goes
                  back to the sidebar the link just skipped. */}
              <div className="app-content" id="main" tabIndex={-1}>
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
                  <Route
                    path="/c/:canvasId"
                    element={
                      // Its own boundary: a stored CanvasDoc that fails to
                      // lay out should cost you the canvas, not the app.
                      <ErrorBoundary label="This canvas failed to render.">
                        <CanvasPage />
                      </ErrorBoundary>
                    }
                  />
                  <Route
                    path="/settings/tokens"
                    element={
                      <div className="page-container">
                        <TokensPage />
                      </div>
                    }
                  />
                  {/* Without this an unknown path rendered the shell with a
                      blank content column and no explanation. */}
                  <Route
                    path="*"
                    element={
                      <div className="page-container">
                        <EmptyState
                          title="There's nothing at this address."
                          hint={<Link to="/">Back to workspaces</Link>}
                        />
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
