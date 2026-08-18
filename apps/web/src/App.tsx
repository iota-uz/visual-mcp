import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Blocks, KeyRound, LayoutGrid, LogOut, Menu, Unplug } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api } from "../../../convex/_generated/api";
import { clearSignInAttempt, SignInButton, useSessionUser, useSignOut } from "./auth";
import { EmptyState } from "./components/EmptyState";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoadingState } from "./components/LoadingState";
import { toastError, useToast } from "./components/Toast";
import { Button } from "./components/ui/Button";
import { Drawer } from "./components/ui/Drawer";
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
        {/* This is the only surface someone outside the org ever reaches,
            and it used to say nothing at all about what they had reached. */}
        <p className="centered-page-lead">
          Your agents draw here. Diagrams, dashboards and reports, authored over MCP and kept at a
          link you can share.
        </p>
        <div className="centered-page-signin">
          {/* Accounts outside the org are rejected server-side during the
              OAuth exchange, so the "signed in as someone else" state can no
              longer exist here. The refusal comes back as a bare redirect,
              which is why SignInButton reconstructs it from a marker. */}
          <SignInButton />
        </div>
        <p className="centered-page-note">@iota.uz Google accounts only.</p>
      </div>
    );
  }

  return <EnsureUser>{children}</EnsureUser>;
}

function sidebarLinkClass({ isActive }: { isActive: boolean }) {
  return isActive ? "app-sidebar-link active" : "app-sidebar-link";
}

/** Enough to navigate by; beyond this the rail becomes a scrolling list. */
const VISIBLE_WORKSPACES = 8;

// Left sidebar, not a top bar — a canvas page (below) needs the full
// viewport height for its viewport to feel like Figma/the original osago
// file, and a horizontal nav bar would eat into that on every page.
function Sidebar({ canvasDrawer = false }: { canvasDrawer?: boolean }) {
  const sessionUser = useSessionUser();
  const signOut = useSignOut();
  const [showAllWorkspaces, setShowAllWorkspaces] = useState(false);
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

  /*
   * Inside the canvas drawer this is a plain <div>, not the <aside> it is
   * on every other page: the drawer is itself a labelled dialog, and a
   * `complementary` landmark nested inside it is a second name for the same
   * region. The drawer also owns the close button, so the sidebar has no
   * onClose of its own to wire up any more.
   */
  const Root = canvasDrawer ? "div" : "aside";

  return (
    <Root
      className={`app-sidebar${canvasDrawer ? " app-sidebar-canvas-drawer" : ""}`}
      aria-label={canvasDrawer ? undefined : "Navigation"}
    >
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
            {/* The workspace links carry the same weight as the index link
                above them — they are the more common destination, and used
                to be rendered smaller than the thing they hang off. */}
            {(showAllWorkspaces ? workspaces : workspaces.slice(0, VISIBLE_WORKSPACES)).map((w) => (
              <li key={w.workspace_id}>
                <NavLink to={`/w/${w.slug}`} className={sidebarLinkClass} title={w.name}>
                  <span>{w.name}</span>
                </NavLink>
              </li>
            ))}
            {/* A long list would otherwise push sign-out off the bottom of
                the rail and turn navigation into scrolling. */}
            {workspaces.length > VISIBLE_WORKSPACES && !showAllWorkspaces && (
              <li>
                <button
                  type="button"
                  className="app-sidebar-more"
                  onClick={() => setShowAllWorkspaces(true)}
                >
                  {workspaces.length - VISIBLE_WORKSPACES} more
                </button>
              </li>
            )}
          </ul>
        )}
        <div className="app-sidebar-group">
          <NavLink to="/settings/tokens" className={sidebarLinkClass} aria-label="MCP tokens">
            <KeyRound size={16} aria-hidden="true" />
            <span>MCP tokens</span>
          </NavLink>
        </div>
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
    </Root>
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
          // The brand moved into the canvas's own command bar: two strips of
          // chrome for one line of text was one too many on the only page
          // outsiders ever see.
          <div className="public-shell">
            <ErrorBoundary label="This canvas failed to render.">
              <PublicCanvasPage />
            </ErrorBoundary>
            <footer className="public-shell-footer">
              Shared from <strong>Visual Canvas</strong> — canvases authored by agents over MCP.
            </footer>
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

/*
 * A routed page, with its own boundary. There used to be exactly one, around
 * the canvas viewer, so a Convex query that threw on Home, Workspace or
 * Tokens took the whole shell down with it — sidebar included, leaving no
 * way to navigate anywhere else.
 */
function Page({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <ErrorBoundary label={label}>
      <div className="page-container">{children}</div>
    </ErrorBoundary>
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
          <Drawer
            id="canvas-navigation"
            className="canvas-navigation-drawer"
            side="left"
            open={navigationOpen}
            onClose={() => setNavigationOpen(false)}
            label="Navigation"
            closeLabel="Close navigation"
          >
            <Sidebar canvasDrawer />
          </Drawer>
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
              <Page label="Workspaces failed to load.">
                <HomePage />
              </Page>
            }
          />
          <Route
            path="/w/:wsSlug"
            element={
              <Page label="This workspace failed to load.">
                <WorkspacePage />
              </Page>
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
              <Page label="Your tokens failed to load.">
                <TokensPage />
              </Page>
            }
          />
          <Route
            path="*"
            element={
              <Page>
                <EmptyState
                  icon={Unplug}
                  title="Nothing at this address."
                  hint={<Link to="/">Back to workspaces</Link>}
                />
              </Page>
            }
          />
        </Routes>
      </div>
    </div>
  );
}
