/**
 * Sign-in for the local agent stack — one navigation, no keystrokes.
 *
 * Why it is a route and not a button on the wall: an agent driving a browser
 * has a reliable way to open a URL and a much less reliable way to click and
 * type into it. Landing on `/dev/sign-in?auto=1` is a single action that
 * either works or fails visibly, which is what the last UI review needed and
 * did not have — a human had to sit down and click through Google twice.
 *
 * It only exists where `import.meta.env.DEV` is true (App.tsx drops the
 * route in a production build, exactly as it drops the kitchen sink) *and*
 * where the backend has `DEV_AUTH_SECRET` set, which is the local backend
 * from `npm run dev:agent` and nothing else. Both halves must be true; one
 * without the other just shows the explanation below.
 */

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Panel } from "../components/ui/Panel";
import { useDocumentTitle } from "../lib/useDocumentTitle";

const DEFAULT_EMAIL = "agent@iota.uz";

// Module scope, not a component value: it is baked in at build time and
// never changes, so it has no business in an effect's dependency list.
const DEV_SECRET = import.meta.env.VITE_DEV_AUTH_SECRET as string | undefined;

export function DevSignInPage() {
  useDocumentTitle("Local sign-in");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // StrictMode double-invokes effects in dev, and this one signs in.
  const attempted = useRef(false);

  const email = params.get("email") ?? DEFAULT_EMAIL;
  const auto = params.get("auto") === "1";

  useEffect(() => {
    if (isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    if (!auto || !DEV_SECRET || attempted.current) return;
    attempted.current = true;
    setBusy(true);
    signIn("dev", { email, secret: DEV_SECRET })
      .then(() => navigate("/", { replace: true }))
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setBusy(false);
      });
  }, [auto, email, signIn, navigate]);

  if (!DEV_SECRET) {
    return (
      <div className="centered-page">
        <h1>Local sign-in</h1>
        <p className="centered-page-lead">
          <code>VITE_DEV_AUTH_SECRET</code> is not set, so this page has nothing to sign in with. It
          is written by the stack script — start the app with <code>npm run dev:agent</code> rather
          than <code>npm run dev</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="centered-page">
      <h1>Local sign-in</h1>
      <p className="centered-page-lead">
        Signs in as <strong>{email}</strong> against the local backend, without Google. This page
        does not exist in a production build.
      </p>
      {error && (
        <Panel tone="warning" role="alert">
          <p>{error}</p>
        </Panel>
      )}
      <div className="centered-page-signin">
        <Button
          busy={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            signIn("dev", { email, secret: DEV_SECRET })
              .then(() => navigate("/", { replace: true }))
              .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : String(err));
                setBusy(false);
              });
          }}
        >
          Sign in as {email}
        </Button>
      </div>
      <p className="centered-page-note">
        Add <code>?auto=1</code> to sign in on load, or <code>?email=…</code> for another @iota.uz
        address.
      </p>
    </div>
  );
}
