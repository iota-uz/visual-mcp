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
type CapturedRegion = { id: string; startMs: number; region: VideoRegion };
export function VideoReview({
  jobId,
  projectId,
  workspaceId,
  onOpenRender,
  onBlocked,
}: {
  jobId: Id<"videoJobs">;
  projectId: Id<"videoProjects">;
  workspaceId: Id<"workspaces">;
  onOpenRender: (jobId: Id<"videoJobs">) => void;
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
  const [annotationMode, setAnnotationMode] = useState(false);
  const [capturedRegion, setCapturedRegion] = useState<CapturedRegion>();
  const approvalKey = useRef(crypto.randomUUID());
  const heading = useRef<HTMLHeadingElement>(null);
  const focusTarget = metadata ? jobId : null;
  useEffect(() => {
    if (focusTarget && heading.current) {
      heading.current.focus({ preventScroll: true });
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
      <header className="video-review-heading">
        <div>
          <span className="video-review-kicker">
            Final check · {metadata.language.toUpperCase()}
          </span>
          <h2 ref={heading} tabIndex={-1}>
            Review this export
          </h2>
          <p>
            Watch the exact export, check sound and captions, then approve or leave a timecoded
            note.
          </p>
        </div>
        <div className="video-review-status">
          <Badge tone={metadata.stale ? "warning" : "success"}>
            {metadata.stale ? "Older candidate" : "Current candidate"}
          </Badge>
          <span>{(metadata.videoDurationMs / 1000).toFixed(1)} seconds</span>
        </div>
      </header>
      {metadata.stale && (
        <p className="video-warning">
          The editable draft is newer. Any approval here applies only to this saved candidate, never
          to the newer draft.
        </p>
      )}
      <RenderCandidates
        workspaceId={workspaceId}
        projectId={projectId}
        activeJobId={jobId}
        onOpenRender={onOpenRender}
      />
      {error && <p role="alert">{error}</p>}
      <div className="video-review-workspace">
        <div className="video-review-screen">
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
              annotationMode={annotationMode}
              onAnnotationModeChange={setAnnotationMode}
              onRegion={(next) => {
                const selection = { id: crypto.randomUUID(), startMs: time, region: next };
                setAnchor({ text: "", startMs: time, region: next });
                setCapturedRegion(selection);
              }}
            />
          ) : (
            <div className="video-review-loading">
              <Button onClick={() => void refresh()}>Load preview</Button>
            </div>
          )}
        </div>
        <aside className="video-review-notes" aria-label="Approval and feedback">
          <div className="video-approval">
            <h3>Approval</h3>
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
                  variant="primary"
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
            capturedRegion={capturedRegion}
            onAnchor={setAnchor}
            onBlocked={onBlocked}
          />
        </aside>
      </div>
      <p className="video-review-integrity">
        Approval is bound to this saved version and exact MP4.
      </p>
      <Disclosure
        summary="Technical details and render provenance"
        className="video-review-technical"
      >
        <p className="video-hint">
          Version <code>{metadata.versionId}</code>
          <br />
          MP4 SHA-256 <code>{metadata.sha256}</code>
        </p>
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
    </section>
  );
}

function RenderCandidates({
  workspaceId,
  projectId,
  activeJobId,
  onOpenRender,
}: {
  workspaceId: Id<"workspaces">;
  projectId: Id<"videoProjects">;
  activeJobId: Id<"videoJobs">;
  onOpenRender: (jobId: Id<"videoJobs">) => void;
}) {
  const jobs = usePaginatedQuery(
    api.videoJobs.listJobs,
    { workspaceId, projectId, kind: "render" },
    { initialNumItems: 10 },
  );
  const renders = jobs.results.filter((job) => job.state === "succeeded");
  if (jobs.status === "LoadingFirstPage") {
    return (
      <p className="video-candidates-loading" role="status">
        Loading saved exports…
      </p>
    );
  }
  if (!renders.length) return null;
  return (
    <nav className="video-candidates" aria-label="Saved render candidates">
      <div className="video-candidates-heading">
        <strong>Saved exports</strong>
        <span>Opening an export does not approve it.</span>
      </div>
      <div className="video-candidate-list">
        {renders.map((render) => (
          <RenderCandidate
            key={render.jobId}
            jobId={render.jobId}
            active={render.jobId === activeJobId}
            onOpenRender={onOpenRender}
          />
        ))}
        {jobs.status === "CanLoadMore" && (
          <Button size="sm" variant="ghost" onClick={() => jobs.loadMore(10)}>
            Earlier exports
          </Button>
        )}
      </div>
    </nav>
  );
}

function RenderCandidate({
  jobId,
  active,
  onOpenRender,
}: {
  jobId: Id<"videoJobs">;
  active: boolean;
  onOpenRender: (jobId: Id<"videoJobs">) => void;
}) {
  const metadata = useQuery(api.videoReview.renderMetadata, { jobId });
  const version = useQuery(
    api.video.getVersion,
    metadata ? { versionId: metadata.versionId } : "skip",
  );
  return (
    <Button
      size="sm"
      variant={active ? "secondary" : "ghost"}
      className="video-candidate"
      aria-current={active ? "true" : undefined}
      disabled={!metadata || active}
      onClick={() => onOpenRender(jobId)}
    >
      {metadata ? (
        <>
          <span className="video-candidate-title">
            <span>{metadata.language.toUpperCase()}</span>
            <strong>{version?.label ?? "Saved version"}</strong>
          </span>
          <span className="video-candidate-state">
            {metadata.stale ? "Older draft" : "Current draft"}
            {metadata.approval ? " · Approved by you" : " · Not approved"}
          </span>
        </>
      ) : (
        "Loading export…"
      )}
    </Button>
  );
}

export function VideoFeedback({
  projectId,
  target,
  time,
  durationMs,
  capturedRegion,
  onAnchor,
  onBlocked,
}: {
  projectId: Id<"videoProjects">;
  target: Target;
  time?: number;
  durationMs?: number;
  capturedRegion?: CapturedRegion;
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
      capturedRegion={capturedRegion}
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
  capturedRegion,
  onAnchor,
  onBlocked,
}: {
  projectId: Id<"videoProjects">;
  target: Target;
  snapshot: { revision: number; body: Feedback; postedCommentId?: string | null };
  time?: number;
  durationMs?: number;
  capturedRegion?: CapturedRegion;
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
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const appliedCapture = useRef<string | null>(null);
  useEffect(() => {
    if (!capturedRegion || appliedCapture.current === capturedRegion.id) return;
    appliedCapture.current = capturedRegion.id;
    editorRef.current.edit({
      ...editorRef.current.document,
      startMs: capturedRegion.startMs,
      region: capturedRegion.region,
    });
  }, [capturedRegion]);
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
      <div className="video-feedback-composer">
        <div className="video-feedback-heading">
          <h3>Leave a note</h3>
          {editor.document.startMs !== undefined ? (
            <Badge tone="info">At {(editor.document.startMs / 1000).toFixed(2)} s</Badge>
          ) : (
            <Badge>Whole video</Badge>
          )}
        </div>
        <label className="video-field">
          What should change?
          <textarea
            aria-label="Your feedback"
            placeholder="Describe the issue and the desired result…"
            value={editor.document.text}
            disabled={disabled || pending.current !== null}
            maxLength={16000}
            onChange={(event) => editor.edit({ ...editor.document, text: event.target.value })}
          />
        </label>
        {time !== undefined && (
          <div className="video-actions video-feedback-anchor-actions">
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => editor.edit({ ...editor.document, startMs: time })}
            >
              Use current frame · {(time / 1000).toFixed(2)} s
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                const { startMs: _start, endMs: _end, region: _region, ...body } = editor.document;
                editor.edit(body);
              }}
            >
              Apply to whole video
            </Button>
          </div>
        )}
        {capturedRegion && appliedCapture.current === capturedRegion.id && (
          <p className="video-feedback-capture" role="status">
            Region attached at {(capturedRegion.startMs / 1000).toFixed(2)} s. Add your note, then
            post it.
          </p>
        )}
        {editor.document.startMs !== undefined && (
          <Disclosure
            summary="Time range and region coordinates"
            className="video-feedback-advanced"
          >
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
                    value={editor.document.region?.[field] ?? 0}
                    onChange={(event) =>
                      editor.edit({
                        ...editor.document,
                        region: {
                          ...(editor.document.region ?? {
                            x: 0.1,
                            y: 0.1,
                            width: 0.8,
                            height: 0.8,
                          }),
                          [field]: Number(event.target.value),
                        },
                      })
                    }
                  />
                ))}
                <Button size="sm" onClick={() => onAnchor?.(editor.document)}>
                  Show anchor
                </Button>
              </div>
            )}
          </Disclosure>
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
      </div>
      <div className="video-feedback-history">
        <div className="video-feedback-heading">
          <h3>Review notes</h3>
          <span className="video-feedback-count">
            {comments.results.length ? `${comments.results.length} loaded` : "No notes yet"}
          </span>
        </div>
        {comments.results.map((comment) => (
          <article key={comment._id} className="video-comment">
            <header className="video-comment-heading">
              <Badge>{comment.status === "resolved" ? "Resolved" : "Open"}</Badge>
              <span className="video-comment-author">
                {comment.authorKind === "human" ? "Human reviewer" : "Agent"}
              </span>
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
            </header>
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
          <Button onClick={() => comments.loadMore(10)}>Load earlier notes</Button>
        )}
      </div>
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
