import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Blocks, KeyRound, LayoutGrid, LogOut, Menu, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { clearSignInAttempt, SignInButton, useSessionUser, useSignOut } from "./auth";
import { EmptyState } from "./components/EmptyState";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoadingState } from "./components/LoadingState";
import { toastError, useToast } from "./components/Toast";
import { Button } from "./components/ui/Button";
import { IconButton } from "./components/ui/IconButton";
import { CanvasPage } from "./routes/Canvas";
import { HomePage } from "./routes/Home";
import { KitchenSinkPage } from "./routes/KitchenSink";
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
function Sidebar({
  canvasDrawer = false,
  onClose,
}: {
  canvasDrawer?: boolean;
  onClose?: () => void;
}) {
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
    <aside
      id={canvasDrawer ? "canvas-navigation" : undefined}
      className={`app-sidebar${canvasDrawer ? " app-sidebar-canvas-drawer" : ""}`}
      aria-label="Navigation"
    >
      {canvasDrawer && (
        <IconButton
          icon={X}
          label="Close navigation"
          iconSize={18}
          className="app-sidebar-close"
          onClick={onClose}
        />
      )}
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
        <Button variant="ghost" size="sm" icon={LogOut} onClick={handleSignOut}>
          <span>Sign out</span>
        </Button>
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
      {/* Outside <AuthGate> on purpose: it renders no data, and the point
          is to be able to look at every primitive without a session. Vite
          folds `import.meta.env.DEV` to false in a production build, so the
          route and the module behind it are dropped from the bundle. */}
      {import.meta.env.DEV && (
        <Route
          path="/dev/kitchen-sink"
          element={
            <div className="page-container">
              <KitchenSinkPage />
            </div>
          }
        />
      )}
      <Route
        path="*"
        element={
          <AuthGate>
            <AuthenticatedApp />
          </AuthGate>
        }
      />
    </Routes>
  );
}

function AuthenticatedApp() {
  const { pathname } = useLocation();
  const isCanvasRoute = pathname.startsWith("/c/");
  const [navigationOpen, setNavigationOpen] = useState(false);

  // A canvas owns the whole workspace. If its drawer was open and the user
  // navigates elsewhere, leave the next page in its conventional layout.
  // `pathname` is the trigger, not an input: the effect reads nothing, it
  // fires *because* the route changed. Biome's offered autofix drops the
  // dependency, and the drawer then stays open across navigations.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => setNavigationOpen(false), [pathname]);

  useEffect(() => {
    if (!navigationOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavigationOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [navigationOpen]);

  return (
    <div className={`app-shell${isCanvasRoute ? " app-shell-canvas" : ""}`}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {isCanvasRoute ? (
        <>
          <IconButton
            icon={Menu}
            label="Open navigation"
            iconSize={19}
            className="canvas-navigation-trigger"
            onClick={() => setNavigationOpen(true)}
            aria-expanded={navigationOpen}
            aria-controls="canvas-navigation"
          />
          {navigationOpen && (
            <>
              <button
                type="button"
                className="canvas-navigation-scrim"
                onClick={() => setNavigationOpen(false)}
                aria-label="Close navigation"
              />
              <Sidebar canvasDrawer onClose={() => setNavigationOpen(false)} />
            </>
          )}
        </>
      ) : (
        <Sidebar />
      )}
      {/* tabIndex -1: without it the skip link moves the viewport but not
          focus in Safari and Chrome, so the next Tab goes back to the
          navigation the link just skipped. */}
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
  );
}
