import { TriangleAlert } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { EmptyState } from "./EmptyState";

/*
 * There was no boundary anywhere in the tree, so a Convex query that threw —
 * a permission error, a schema mismatch, a malformed stored CanvasDoc —
 * unmounted the whole app into a white screen with nothing but a console
 * message. React gives no hook equivalent, so this stays a class.
 */

interface Props {
  children: ReactNode;
  /** Shown instead of the generic copy when the failing area is known. */
  label?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Unhandled render error", error, info.componentStack);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="error-boundary">
        <EmptyState
          icon={TriangleAlert}
          title={this.props.label ?? "Something broke while rendering this page."}
          hint={error.message}
        />
        <div className="error-boundary-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
