import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Button } from "../ui/Button";
import { useDurableJobIntent } from "./useDurableJobIntent";
export function RenderRequest({
  workspaceId,
  projectId,
  versionId,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"videoProjects">;
  versionId: Id<"videoVersions">;
}) {
  const submit = useMutation(api.videoJobs.submit);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const pending = useDurableJobIntent<Parameters<typeof submit>[0]>(
    `render:${workspaceId}:${versionId}`,
  );
  return (
    <div className="video-render-request">
      <Button
        disabled={busy || submitted || !pending.ready}
        onClick={() => {
          setBusy(true);
          setMessage("");
          const request = pending.current ?? {
            workspaceId,
            projectId,
            versionId,
            request: { kind: "render", versionId, mode: "final" },
            idempotencyKey: crypto.randomUUID(),
          };
          void Promise.resolve()
            .then(() => {
              pending.save(request);
              return submit(request);
            })
            .then(() => {
              pending.save(null);
              setSubmitted(true);
              setMessage("Render requested. Track its durable state in Production below.");
            })
            .catch(() =>
              setMessage(
                "Submission was not confirmed. Retry uses the same operation key; inspect Production before submitting another candidate.",
              ),
            )
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Submitting…" : "Render this saved version"}
      </Button>
      {submitted && (
        <Button
          size="sm"
          onClick={() => {
            if (
              !window.confirm(
                "Start a separate render attempt of this exact version? Inspect existing jobs first.",
              )
            )
              return;
            setSubmitted(false);
            setMessage("New attempt prepared. Click Render to submit it.");
          }}
        >
          Prepare a separate render attempt
        </Button>
      )}
      <p className="video-hint" role="status">
        {pending.error ||
          message ||
          "Uses only the pinned timeline and registered media. Does not start image or voice generation."}
      </p>
    </div>
  );
}
