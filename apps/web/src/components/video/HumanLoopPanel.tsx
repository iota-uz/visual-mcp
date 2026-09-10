import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Badge } from "../Badge";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/TextInput";

export function HumanLoopPanel({
  projectId,
  language,
}: {
  projectId: Id<"videoProjects">;
  language: "ru" | "uz";
}) {
  const loop = useQuery(api.videoWorkflow.getLoop, { projectId, language });
  const pause = useMutation(api.videoWorkflow.pause);
  const resume = useMutation(api.videoWorkflow.resume);
  const abandon = useMutation(api.videoWorkflow.abandonPending);
  const [reason, setReason] = useState("");
  const [cancelRunning, setCancelRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef<{
    action: "pause" | "resume" | "abandon";
    args: { loopId: Id<"videoLoops">; expectedLoopRevision: string; idempotencyKey: string };
    reason: string;
    cancelRunning: boolean;
  } | null>(null);
  if (!loop) return <p role="status">Loading {language.toUpperCase()} improvement loop…</p>;
  const exhausted =
    loop.iteration >= loop.iterationLimit || loop.noProgress >= loop.noProgressLimit;
  async function change(action: "pause" | "resume" | "abandon") {
    if (!loop) return;
    const intent = pending.current ?? {
      action,
      args: {
        loopId: loop.loopId,
        expectedLoopRevision: loop.revisionId,
        idempotencyKey: crypto.randomUUID(),
      },
      reason,
      cancelRunning,
    };
    if (
      !pending.current &&
      action === "abandon" &&
      !window.confirm(
        "Archive the pending proposal with this reason? Spent rounds and previous candidates are retained. This does not approve any video.",
      )
    )
      return;
    pending.current = intent;
    setBusy(true);
    setMessage("");
    try {
      if (intent.action === "pause")
        await pause({
          ...intent.args,
          reason: intent.reason,
          runningJobs: intent.cancelRunning ? "request_cancel" : "leave_running",
        });
      else if (intent.action === "abandon")
        await abandon({ ...intent.args, reason: intent.reason });
      else await resume(intent.args);
      pending.current = null;
      setMessage(
        intent.action === "resume"
          ? "Loop resumed within its existing limits. The agent must read current context; no generation was started by this button."
          : intent.action === "abandon"
            ? "Pending proposal archived. Counters and selected candidate are unchanged; review the current state before resuming."
            : "Human pause saved. Cancellation requests do not guarantee already dispatched provider work has stopped.",
      );
    } catch (error) {
      const data = error && typeof error === "object" && "data" in error ? error.data : null;
      const known =
        data && typeof data === "object" && "effect" in data && data.effect === "not_applied";
      if (known) pending.current = null;
      setMessage(
        known
          ? "message" in data
            ? String(data.message)
            : "Action not applied. Read the updated loop and choose again."
          : "Submission not confirmed. Retry the identical action; no new operation key will be used.",
      );
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || Boolean(pending.current);
  return (
    <section className="video-human-loop" aria-label="Human improvement loop controls">
      <div className="video-section-heading">
        <h2>Improvement loop · {language.toUpperCase()}</h2>
        <Badge>{loop.state}</Badge>
      </div>
      <p className="video-hint">
        Rounds {loop.iteration} / {loop.iterationLimit} · no-progress rounds {loop.noProgress} /{" "}
        {loop.noProgressLimit}. These are experiment limits, not spending budgets.
      </p>
      {loop.stopReason && <p className="video-warning">{loop.stopReason}</p>}
      {loop.pausedByHuman && (
        <p className="video-hint">Paused by a human. An agent cannot resume this pause for you.</p>
      )}
      {loop.pendingProposal?.invalidated && (
        <p className="video-warning">
          Pending proposal is outdated:{" "}
          {loop.pendingProposal.causes
            .map((cause) =>
              cause === "human_input_changed" ? "human feedback changed" : "project brief changed",
            )
            .join("; ")}
          . Archive it explicitly, then replan from current context.
        </p>
      )}
      <p className="video-hint">
        Baseline: {loop.baseline ?? "not set"} · selected candidate:{" "}
        {loop.selectedCandidate ?? "none"}. Agent selection is not your approval.
      </p>
      {loop.pendingProposalIds.length > 0 && (
        <p className="video-hint">
          Pending proposal: {loop.pendingProposalIds.join(", ")}. If human feedback invalidated its
          context, archive it explicitly before a fresh proposal.
        </p>
      )}
      {exhausted && (
        <p className="video-warning">
          Experiment limits are exhausted. Resume cannot reset them; a separately defined experiment
          is required.
        </p>
      )}
      <label className="video-field">
        Reason for human pause or replanning
        <textarea
          maxLength={2000}
          value={reason}
          disabled={locked}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <Checkbox
        label="Also request cancellation of active project jobs in scope"
        checked={cancelRunning}
        disabled={locked}
        onChange={(event) => setCancelRunning(event.target.checked)}
      />
      <div className="video-actions">
        {pending.current ? (
          <Button disabled={busy} onClick={() => void change(pending.current!.action)}>
            Retry same {pending.current.action}
          </Button>
        ) : (
          <>
            <Button disabled={busy || !reason.trim()} onClick={() => void change("pause")}>
              Pause as human
            </Button>
            <Button
              disabled={busy || !reason.trim() || loop.pendingProposalIds.length === 0}
              onClick={() => void change("abandon")}
            >
              Archive pending proposal
            </Button>
            <Button
              disabled={
                busy || exhausted || loop.state !== "paused" || loop.pendingProposalIds.length > 0
              }
              onClick={() => void change("resume")}
            >
              Resume existing experiment
            </Button>
          </>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
