import { useQuery } from "convex/react";
import { Inbox as InboxIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { EmptyState } from "../components/EmptyState";
import { LoadingState } from "../components/LoadingState";
import { PageHeader } from "../components/PageHeader";
import { useDocumentTitle } from "../lib/useDocumentTitle";

export function InboxPage() {
  useDocumentTitle("Needs you");
  const inbox = useQuery(api.inbox.needsYou, {});

  return (
    <div className="page-stack">
      <PageHeader
        title="Needs you"
        subtitle="Agent work waiting on a person."
        crumbs={[{ to: "/", label: "Workspaces" }]}
      />
      {inbox === undefined ? (
        <LoadingState />
      ) : inbox.items.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="Nothing waiting."
          hint="Comments and video loops land here when they need you."
        />
      ) : (
        <ul className="card-list">
          {inbox.items.map((item) => (
            <li key={`${item.kind}:${item.id}`} className="card-list-item">
              <span className="eyebrow">
                {item.workspace}
                {item.workspace ? " · " : ""}
                {item.kind === "comment" ? "Canvas" : "Video"}
              </span>
              <Link to={item.href}>
                <strong>{item.title}</strong>
                {item.detail && <span className="muted"> — {item.detail}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
