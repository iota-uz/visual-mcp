import { useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Badge } from "../Badge";
import { Button } from "../ui/Button";
import { Disclosure } from "../ui/Disclosure";
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
  const [intent, setIntent] = useState<"pause" | "abandon" | null>(null);
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
  const stateLabel =
    loop.state === "paused"
      ? "Paused"
      : loop.state === "active"
        ? "Improving"
        : loop.state === "finished"
          ? "Complete"
          : loop.state === "awaiting_human"
            ? "Needs review"
            : "Ready";
  return (
    <section className="video-human-loop" aria-label="Human improvement loop controls">
      <div className="video-section-heading">
        <div>
          <h2>Agent · {language.toUpperCase()}</h2>
          <p className="video-hint">Only you can approve an export.</p>
        </div>
        <Badge
          tone={
            loop.state === "active"
              ? "info"
              : loop.state === "paused" || loop.state === "awaiting_human"
                ? "warning"
                : "neutral"
          }
        >
          {stateLabel}
        </Badge>
      </div>
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
      {exhausted && (
        <p className="video-warning">
          Experiment limits are exhausted. Resume cannot reset them; a separately defined experiment
          is required.
        </p>
      )}
      {!loop.baseline && loop.state === "idle" && (
        <p className="video-loop-guidance">
          No improvement run has started. An agent must establish a baseline before iteration can
          begin.
        </p>
      )}
      <div className="video-actions">
        {pending.current ? (
          <Button
            disabled={busy}
            onClick={() => {
              const action = pending.current?.action;
              if (action) void change(action);
            }}
          >
            Retry same {pending.current.action}
          </Button>
        ) : (
          <>
            {loop.state === "active" && (
              <Button disabled={busy} onClick={() => setIntent("pause")}>
                Pause agent
              </Button>
            )}
            {loop.pendingProposalIds.length > 0 && (
              <Button disabled={busy} onClick={() => setIntent("abandon")}>
                Archive pending proposal
              </Button>
            )}
            {loop.state === "paused" && (
              <Button
                variant="primary"
                disabled={busy || exhausted || loop.pendingProposalIds.length > 0}
                onClick={() => void change("resume")}
              >
                Resume improvement
              </Button>
            )}
          </>
        )}
      </div>
      {intent && !pending.current && (
        <fieldset className="video-loop-intent">
          <legend className="visually-hidden">
            {intent === "pause" ? "Pause agent" : "Archive pending proposal"}
          </legend>
          <div>
            <strong>
              {intent === "pause"
                ? "Why are you pausing?"
                : "Why should this proposal be archived?"}
            </strong>
            <p className="video-hint video-loop-intent-copy">
              This context helps the next agent continue without repeating rejected work.
            </p>
          </div>
          <label className="video-field">
            Reason for human pause or replanning
            <textarea
              maxLength={2000}
              value={reason}
              disabled={locked}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {intent === "pause" && (
            <Checkbox
              label="Also request cancellation of active project jobs"
              checked={cancelRunning}
              disabled={locked}
              onChange={(event) => setCancelRunning(event.target.checked)}
            />
          )}
          <div className="video-actions">
            <Button
              variant={intent === "pause" ? "primary" : "warning"}
              disabled={busy || !reason.trim()}
              onClick={() => void change(intent)}
            >
              {intent === "pause" ? "Confirm pause" : "Archive proposal"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setIntent(null);
                setReason("");
                setCancelRunning(false);
              }}
            >
              Keep current state
            </Button>
          </div>
        </fieldset>
      )}
      {message && <p role="status">{message}</p>}
      <Disclosure summary="Experiment details" className="video-loop-advanced">
        <dl className="video-loop-facts">
          <div>
            <dt>Rounds</dt>
            <dd>
              {loop.iteration} / {loop.iterationLimit}
            </dd>
          </div>
          <div>
            <dt>Rounds without progress</dt>
            <dd>
              {loop.noProgress} / {loop.noProgressLimit}
            </dd>
          </div>
          <div>
            <dt>Baseline</dt>
            <dd>{loop.baseline ?? "Not set"}</dd>
          </div>
          <div>
            <dt>Selected candidate</dt>
            <dd>{loop.selectedCandidate ?? "None"}</dd>
          </div>
        </dl>
        <p className="video-hint">
          These are experiment limits, not spending budgets. Agent selection is not human approval.
        </p>
        {loop.pendingProposalIds.length > 0 && (
          <p className="video-hint">Pending proposal IDs: {loop.pendingProposalIds.join(", ")}.</p>
        )}
      </Disclosure>
    </section>
  );
}
