import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Badge } from "../../Badge";
import { Button } from "../../ui/Button";
import { Disclosure } from "../../ui/Disclosure";
import { TextInput } from "../../ui/TextInput";
import { handleHistoryKey, useDocumentHistory } from "../useDocumentHistory";
import { useRevisionEditor } from "../useRevisionEditor";
import { useUnsavedNavigation } from "../useUnsavedNavigation";
import type { VideoRegion } from "../VideoPlayer";

type Target = Parameters<
  ReturnType<typeof useMutation<typeof api.videoReview.addComment>>
>[0]["target"];
export type Feedback = { text: string; startMs?: number; endMs?: number; region?: VideoRegion };
export type CapturedRegion = { id: string; startMs: number; region: VideoRegion };

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
      key={JSON.stringify(target)}
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
  const revisionEditor = useRevisionEditor<Feedback>(
    { revision: String(snapshot.revision), document: snapshot.body },
    async (body, revision, key) =>
      String(
        (await saveDraft({ target, body, expectedRevision: Number(revision), idempotencyKey: key }))
          .revision,
      ),
  );
  const [busy, setBusy] = useState(false);
  const pending = useRef<Parameters<typeof addComment>[0] | null>(null);
  const history = useDocumentHistory(
    { feedback: revisionEditor },
    busy || pending.current !== null,
  );
  const editor = { ...revisionEditor, edit: (next: Feedback) => history.edit("feedback", next) };
  const historyRef = useRef(history);
  historyRef.current = history;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const element = event.target instanceof HTMLElement ? event.target : null;
      if (element?.closest(".video-feedback-composer")) {
        handleHistoryKey(event, historyRef.current);
        return;
      }
      if (
        element?.closest(
          'input,textarea,select,[contenteditable="true"],[contenteditable=""],dialog,[role="dialog"]',
        )
      )
        return;
      if (element === document.body || element?.closest(".video-review"))
        handleHistoryKey(event, historyRef.current);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const appliedCapture = useRef<string | null>(null);
  useEffect(() => {
    if (
      !capturedRegion ||
      editor.locked ||
      busy ||
      pending.current ||
      appliedCapture.current === capturedRegion.id
    )
      return;
    appliedCapture.current = capturedRegion.id;
    editorRef.current.edit({
      ...editorRef.current.document,
      startMs: capturedRegion.startMs,
      region: capturedRegion.region,
    });
  }, [capturedRegion, editor.locked, busy]);
  const [message, setMessage] = useState("");
  const [postedRevision, setPostedRevision] = useState<number | null>(null);
  const alreadyPosted = !!snapshot.postedCommentId || postedRevision === snapshot.revision;
  const blocked = editor.dirty || editor.awaitingSubscription || busy;
  useUnsavedNavigation(blocked);
  useEffect(() => {
    onBlocked(blocked);
    return () => onBlocked(false);
  }, [blocked, onBlocked]);
  const disabled = editor.locked || busy || pending.current !== null;
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
          <h3>Note</h3>
          <span className="video-feedback-anchor">
            {editor.document.startMs !== undefined
              ? `At ${(editor.document.startMs / 1000).toFixed(2)} s`
              : "Whole video"}
          </span>
        </div>
        <textarea
          aria-label="Your feedback"
          placeholder="What should change?"
          value={editor.document.text}
          disabled={disabled || pending.current !== null}
          maxLength={16000}
          onChange={(event) => editor.edit({ ...editor.document, text: event.target.value })}
        />
        {time !== undefined && (
          <div className="video-actions video-feedback-anchor-actions">
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => editor.edit({ ...editor.document, startMs: time })}
            >
              Use current frame · {(time / 1000).toFixed(2)} s
            </Button>
            {editor.document.startMs !== undefined && (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  const {
                    startMs: _start,
                    endMs: _end,
                    region: _region,
                    ...body
                  } = editor.document;
                  editor.edit(body);
                }}
              >
                Whole video
              </Button>
            )}
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
        {editor.state === "saving" && (
          <p className="video-hint" role="status">
            Saving note…
          </p>
        )}
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
            {alreadyPosted ? "Posted — edit to add another" : "Post note"}
          </Button>
          <Button
            variant="ghost"
            disabled={disabled || pending.current !== null}
            onClick={() => editor.edit({ text: "" })}
          >
            Clear
          </Button>
        </div>
        {message && <p role="status">{message}</p>}
      </div>
      <div className="video-feedback-history">
        <div className="video-feedback-heading">
          <h3>Notes</h3>
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
