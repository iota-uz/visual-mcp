import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Badge } from "../Badge";
import { Button } from "../ui/Button";
import { Disclosure } from "../ui/Disclosure";
import { Checkbox, TextInput } from "../ui/TextInput";
import { useRevisionEditor } from "./useRevisionEditor";
import { useUnsavedNavigation } from "./useUnsavedNavigation";
import { VideoPlayer, type VideoRegion } from "./VideoPlayer";

type Target = Parameters<
  ReturnType<typeof useMutation<typeof api.videoReview.addComment>>
>[0]["target"];
type Feedback = { text: string; startMs?: number; endMs?: number; region?: VideoRegion };
type Preview = { videoUrl: string; posterUrl: string; captionsUrl: string; expiresAt: number };
export function VideoReview({
  jobId,
  projectId,
  onBlocked,
}: {
  jobId: Id<"videoJobs">;
  projectId: Id<"videoProjects">;
  onBlocked: (value: boolean) => void;
}) {
  const metadata = useQuery(api.videoReview.renderMetadata, { jobId });
  const getPreview = useAction(api.videoReview.preview);
  const approve = useMutation(api.videoReview.approve);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [time, setTime] = useState(0);
  const [anchor, setAnchor] = useState<Feedback | undefined>();
  const approvalKey = useRef(crypto.randomUUID());
  const heading = useRef<HTMLHeadingElement>(null);
  const focusTarget = metadata ? jobId : null;
  useEffect(() => {
    if (focusTarget && heading.current) {
      heading.current.focus({ preventScroll: true });
      heading.current.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }
  }, [focusTarget]);
  async function refresh() {
    setLoaded(false);
    setConfirmed(false);
    setError("");
    try {
      setPreview(await getPreview({ jobId }));
    } catch {
      setError("Preview link could not be loaded. Nothing has been approved.");
    }
  }
  useEffect(() => {
    let active = true;
    void getPreview({ jobId })
      .then((value) => {
        if (active) setPreview(value);
      })
      .catch(() => {
        if (active) setError("Preview unavailable. Retry to obtain a fresh link.");
      });
    return () => {
      active = false;
    };
  }, [jobId, getPreview]);
  if (!metadata) return <p role="status">Loading exact render…</p>;
  if (metadata.projectId !== projectId)
    return <p role="alert">This render belongs to another project.</p>;
  return (
    <section className="video-review" aria-label="Review exact render">
      <h2 ref={heading} tabIndex={-1}>
        Review · {metadata.language.toUpperCase()}
      </h2>
      <p className="video-hint">
        Version {metadata.versionId} · MP4 SHA-256 <code>{metadata.sha256}</code>
      </p>
      {metadata.stale && (
        <p className="video-warning">
          The editable draft is newer. Any approval here applies only to this saved candidate, never
          to the newer draft.
        </p>
      )}
      <Disclosure summary="Render engine provenance">
        {metadata.engine ? (
          <>
            <p className="video-hint">
              Remotion {metadata.engine.remotionVersion} · FFmpeg {metadata.engine.ffmpegVersion} ·
              worker build {metadata.engine.workerBuildSha ?? "not recorded"}
            </p>
            {metadata.engine.fonts.map((font) => (
              <p className="video-hint" key={font.family}>
                {font.family}: <code>{font.sha256}</code>
              </p>
            ))}
          </>
        ) : (
          <p className="video-hint">
            Engine provenance was not recorded for this historical render; current deployment
            versions do not describe it.
          </p>
        )}
      </Disclosure>
      {error && <p role="alert">{error}</p>}
      {preview ? (
        <VideoPlayer
          key={`${jobId}-${metadata.sha256}`}
          asset={{ ...metadata, ...preview }}
          onLoaded={(ready) => {
            setLoaded(ready);
            if (!ready) setConfirmed(false);
          }}
          onTime={setTime}
          seekMs={anchor?.startMs}
          region={anchor?.region}
          onRefresh={() => void refresh()}
        />
      ) : (
        <Button onClick={() => void refresh()}>Load preview</Button>
      )}
      <div className="video-approval">
        {metadata.approval ? (
          <Badge tone="success">You approved this exact MP4</Badge>
        ) : (
          <>
            <Checkbox
              checked={confirmed}
              disabled={!loaded || !metadata.approvable || busy}
              onChange={(event) => setConfirmed(event.target.checked)}
              label={`I reviewed this ${metadata.stale ? "older " : ""}${metadata.language.toUpperCase()} candidate and its exact MP4, including sound and captions.`}
            />
            <Button
              disabled={!loaded || !confirmed || !metadata.approvable || busy}
              onClick={() => {
                setBusy(true);
                setError("");
                void approve({
                  jobId,
                  versionId: metadata.versionId,
                  language: metadata.language,
                  sha256: metadata.sha256,
                  confirmedViewed: true,
                  idempotencyKey: approvalKey.current,
                })
                  .catch(() =>
                    setError(
                      "Approval was not confirmed. Retry this exact candidate; do not assume it was accepted.",
                    ),
                  )
                  .finally(() => setBusy(false));
              }}
            >
              {busy ? "Confirming…" : "Approve this exact MP4"}
            </Button>
            {!metadata.approvable && (
              <p className="video-hint">
                Partial previews and analysis proxies cannot be approved.
              </p>
            )}
          </>
        )}
      </div>
      <VideoFeedback
        key={jobId}
        projectId={projectId}
        target={{ kind: "render", jobId }}
        time={time}
        durationMs={metadata.videoDurationMs}
        onAnchor={setAnchor}
        onBlocked={onBlocked}
      />
    </section>
  );
}

export function VideoFeedback({
  projectId,
  target,
  time,
  durationMs,
  onAnchor,
  onBlocked,
}: {
  projectId: Id<"videoProjects">;
  target: Target;
  time?: number;
  durationMs?: number;
  onAnchor?: (body: Feedback) => void;
  onBlocked: (value: boolean) => void;
}) {
  const draft = useQuery(api.videoReview.getDraft, { target });
  if (!draft) return <p role="status">Loading saved feedback…</p>;
  return (
    <FeedbackEditor
      projectId={projectId}
      target={target}
      snapshot={draft}
      time={time}
      durationMs={durationMs}
      onAnchor={onAnchor}
      onBlocked={onBlocked}
    />
  );
}
function FeedbackEditor({
  projectId,
  target,
  snapshot,
  time,
  durationMs,
  onAnchor,
  onBlocked,
}: {
  projectId: Id<"videoProjects">;
  target: Target;
  snapshot: { revision: number; body: Feedback; postedCommentId?: string | null };
  time?: number;
  durationMs?: number;
  onAnchor?: (body: Feedback) => void;
  onBlocked: (value: boolean) => void;
}) {
  const saveDraft = useMutation(api.videoReview.saveDraft);
  const addComment = useMutation(api.videoReview.addComment);
  const setStatus = useMutation(api.videoReview.setCommentStatus);
  const reanchor = useMutation(api.videoReview.reanchorComment);
  const comments = usePaginatedQuery(
    api.videoReview.comments,
    { projectId, target },
    { initialNumItems: 10 },
  );
  const editor = useRevisionEditor<Feedback>(
    { revision: String(snapshot.revision), document: snapshot.body },
    async (body, revision, key) =>
      String(
        (await saveDraft({ target, body, expectedRevision: Number(revision), idempotencyKey: key }))
          .revision,
      ),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef<Parameters<typeof addComment>[0] | null>(null);
  const [postedRevision, setPostedRevision] = useState<number | null>(null);
  const alreadyPosted = !!snapshot.postedCommentId || postedRevision === snapshot.revision;
  const blocked = editor.dirty || editor.awaitingSubscription || busy;
  useUnsavedNavigation(blocked);
  useEffect(() => {
    onBlocked(blocked);
    return () => onBlocked(false);
  }, [blocked, onBlocked]);
  const disabled = editor.state === "saving" || editor.state === "error" || busy;
  async function post() {
    const request = pending.current ?? {
      target,
      body: editor.document,
      draftRevision: snapshot.revision,
      idempotencyKey: crypto.randomUUID(),
    };
    pending.current = request;
    setBusy(true);
    setMessage("");
    try {
      await addComment(request);
      setPostedRevision(snapshot.revision);
      pending.current = null;
      setMessage("Comment posted. Your saved draft is retained until you clear it.");
    } catch {
      setMessage("Posting was not confirmed. Retry the same comment before editing it.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="video-feedback" aria-label="Feedback">
      <h3>Feedback</h3>
      <label className="video-field">
        Your note
        <textarea
          aria-label="Your feedback"
          value={editor.document.text}
          disabled={disabled || pending.current !== null}
          maxLength={16000}
          onChange={(event) => editor.edit({ ...editor.document, text: event.target.value })}
        />
      </label>
      {time !== undefined && (
        <div className="video-actions">
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => editor.edit({ ...editor.document, startMs: time })}
          >
            Anchor at {(time / 1000).toFixed(2)} s
          </Button>
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => {
              const { startMs: _start, endMs: _end, region: _region, ...body } = editor.document;
              editor.edit(body);
            }}
          >
            Whole video
          </Button>
        </div>
      )}
      {editor.document.startMs !== undefined && (
        <>
          <div className="video-field-pair">
            <TextInput
              id="review-start"
              label="Start (ms)"
              labelVisible
              type="number"
              min={0}
              value={editor.document.startMs}
              disabled={disabled}
              onChange={(event) =>
                editor.edit({ ...editor.document, startMs: Number(event.target.value) })
              }
            />
            <TextInput
              id="review-end"
              label="End (ms, optional)"
              labelVisible
              type="number"
              min={0}
              value={editor.document.endMs ?? ""}
              disabled={disabled}
              onChange={(event) => {
                const { endMs: _, ...body } = editor.document;
                editor.edit(
                  event.target.value ? { ...body, endMs: Number(event.target.value) } : body,
                );
              }}
            />
          </div>
          <Checkbox
            label="Mark a region (normalized coordinates)"
            disabled={disabled}
            checked={!!editor.document.region}
            onChange={(event) => {
              const { region: _, ...body } = editor.document;
              editor.edit(
                event.target.checked
                  ? { ...body, region: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 } }
                  : body,
              );
            }}
          />
          {editor.document.region && (
            <div className="video-region-fields">
              {(["x", "y", "width", "height"] as const).map((field) => (
                <TextInput
                  key={field}
                  id={`region-${field}`}
                  label={field}
                  labelVisible
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  disabled={disabled}
                  value={editor.document.region![field]}
                  onChange={(event) =>
                    editor.edit({
                      ...editor.document,
                      region: { ...editor.document.region!, [field]: Number(event.target.value) },
                    })
                  }
                />
              ))}
              <Button size="sm" onClick={() => onAnchor?.(editor.document)}>
                Show anchor
              </Button>
            </div>
          )}
        </>
      )}
      <p className="video-hint" role="status">
        Feedback draft: {editor.state}
      </p>
      {editor.error && (
        <div role="alert">
          <p>{editor.error}</p>
          <pre>{JSON.stringify(editor.savedDocument, null, 2)}</pre>
          <Button onClick={editor.useSaved}>Use saved draft</Button>
          <Button onClick={() => void editor.save()}>Retry save</Button>
        </div>
      )}
      <div className="video-actions">
        <Button
          disabled={
            disabled ||
            alreadyPosted ||
            !editor.document.text.trim() ||
            editor.dirty ||
            editor.awaitingSubscription
          }
          onClick={() => void post()}
        >
          {alreadyPosted
            ? "Draft already posted — edit to create another note"
            : "Post saved comment"}
        </Button>
        <Button
          disabled={disabled || pending.current !== null}
          onClick={() => editor.edit({ text: "" })}
        >
          Clear draft
        </Button>
      </div>
      {message && <p role="status">{message}</p>}
      {comments.results.map((comment) => (
        <article key={comment._id} className="video-comment">
          <div className="video-actions">
            <Badge>
              {comment.authorKind} · {comment.status}
            </Badge>
            {comment.body.startMs !== undefined && (
              <Button
                size="sm"
                disabled={durationMs !== undefined && comment.body.startMs >= durationMs}
                onClick={() => onAnchor?.(comment.body)}
              >
                At {(comment.body.startMs / 1000).toFixed(2)} s
                {durationMs !== undefined && comment.body.startMs >= durationMs
                  ? " · historical anchor outside video frames"
                  : ""}
              </Button>
            )}
          </div>
          <p>{comment.body.text}</p>
          {comment.completion && (
            <p className="video-hint">
              Agent/work completion: {comment.completion.summary}. This is not human resolution.
            </p>
          )}
          <div className="video-actions">
            <Button
              size="sm"
              onClick={() => {
                void setStatus({
                  commentId: comment._id,
                  expectedRevision: comment.revision,
                  idempotencyKey: crypto.randomUUID(),
                  status: comment.status === "resolved" ? "open" : "resolved",
                }).catch(() =>
                  setMessage(
                    "Only the note author can resolve it. Refresh if another reviewer changed it.",
                  ),
                );
              }}
            >
              {comment.status === "resolved" ? "Reopen my note" : "Resolve my note"}
            </Button>
            {time !== undefined && (
              <Button
                size="sm"
                onClick={() => {
                  const reason = window.prompt(
                    "Why move this note to the current time? Its previous anchor will be retained.",
                  );
                  if (!reason?.trim()) return;
                  const { endMs: _end, ...body } = comment.body;
                  void reanchor({
                    commentId: comment._id,
                    expectedRevision: comment.revision,
                    idempotencyKey: crypto.randomUUID(),
                    target,
                    body: { ...body, startMs: time },
                    reason,
                  }).catch(() =>
                    setMessage(
                      "Anchor was not moved. Only the author can move a current note; keep its time within this render.",
                    ),
                  );
                }}
              >
                Move my note to current time
              </Button>
            )}
          </div>
          <CommentHistory commentId={comment._id} />
        </article>
      ))}
      {comments.status === "CanLoadMore" && (
        <Button onClick={() => comments.loadMore(10)}>More comments</Button>
      )}
    </section>
  );
}

function CommentHistory({ commentId }: { commentId: Id<"videoComments"> }) {
  const history = usePaginatedQuery(
    api.videoReview.anchorHistory,
    { commentId },
    { initialNumItems: 5 },
  );
  const replies = usePaginatedQuery(api.videoReview.replies, { commentId }, { initialNumItems: 5 });
  return (
    <Disclosure summary="Replies and anchor history">
      {replies.results.map((reply) => (
        <p key={reply._id}>
          {reply.authorKind}: {reply.body}
        </p>
      ))}
      {history.results.map((move) => (
        <p key={move._id}>
          Moved from {move.previousBody.startMs ?? "whole target"} ms to{" "}
          {move.body.startMs ?? "whole target"} ms: {move.reason}
        </p>
      ))}
      {!history.results.length && !replies.results.length && (
        <p className="video-hint">No replies or anchor changes.</p>
      )}
      {history.status === "CanLoadMore" && (
        <Button size="sm" onClick={() => history.loadMore(5)}>
          Earlier anchors
        </Button>
      )}
      {replies.status === "CanLoadMore" && (
        <Button size="sm" onClick={() => replies.loadMore(5)}>
          Earlier replies
        </Button>
      )}
    </Disclosure>
  );
}
