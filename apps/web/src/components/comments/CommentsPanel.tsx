import type { CanvasDoc } from "@visual-canvas/canvas";
import { MessageSquarePlus, X } from "lucide-react";
import { Disclosure } from "../ui/Disclosure";
import { IconButton } from "../ui/IconButton";
import { CommentAvatar, CommentByline } from "./CommentPieces";
import { type CommentThread, commentAnchorLabel } from "./types";

/*
 * The list, not the conversation. Reading and answering a thread happens on
 * the canvas, in a popover pinned to the thing being discussed; this panel
 * exists for the question that popover cannot answer — "what is outstanding
 * on this Page?" — and for reaching a pin that is currently off screen.
 * Clicking a row opens the thread where it lives.
 */
export function CommentsPanel({
  threads,
  doc,
  activeId,
  onActiveChange,
  onClose,
}: {
  threads: CommentThread[];
  doc: CanvasDoc | null;
  activeId: string | null;
  onActiveChange: (commentId: string | null) => void;
  onClose: () => void;
}) {
  /* Three buckets, and they are not the same job: `completed` is the
     agent's claim waiting on this reader, `open` is what nobody has
     answered, `resolved` is history. */
  const awaiting = threads.filter((thread) => thread.status === "completed");
  const openThreads = threads.filter((thread) => thread.status === "open");
  const resolved = threads.filter((thread) => thread.status === "resolved");
  const groups = [
    { key: "awaiting", title: "Needs you", items: awaiting },
    { key: "open", title: "Open", items: openThreads },
  ].filter((group) => group.items.length > 0);

  function renderThread(thread: CommentThread) {
    const isActive = thread.comment_id === activeId;
    const anchor = thread.where ?? commentAnchorLabel(doc, thread.node_id, thread.name, thread.el);
    /* What was said last, whoever said it. For a completed thread that is
       the agent's claim, which is exactly the thing this row exists to
       tell you about — a reply count would not. */
    const lastReply = thread.replies.at(-1);
    const last =
      thread.status === "completed" && thread.completion
        ? { who: "Agent", body: thread.completion.summary }
        : lastReply
          ? { who: lastReply.author_kind === "agent" ? "Agent" : "You", body: lastReply.body }
          : null;
    return (
      <li key={thread.comment_id} className="comment-row" data-status={thread.status}>
        <button
          type="button"
          data-active={isActive ? "" : undefined}
          aria-pressed={isActive}
          onClick={() => onActiveChange(isActive ? null : thread.comment_id)}
        >
          <CommentAvatar kind={thread.author_kind} size={22} />
          <span className="comment-row-main">
            <span className="comment-row-top">
              <CommentByline kind={thread.author_kind} at={thread.created_at} />
              <span className="comment-row-anchor" title={anchor}>
                {anchor}
              </span>
            </span>
            <span className="comment-row-body">{thread.body}</span>
            {/* The last word in the thread is what tells you whether it has
                moved since you left it — a reply count does not. */}
            {last && (
              <span className="comment-row-last">
                <strong>{last.who}:</strong> {last.body}
              </span>
            )}
          </span>
        </button>
      </li>
    );
  }

  return (
    <aside className="canvas-comments-panel" aria-label="Comments">
      <header>
        <strong>Comments</strong>
        <span className="canvas-comments-count">
          {threads.length === 0
            ? "None yet"
            : [
                awaiting.length > 0 ? `${awaiting.length} awaiting you` : null,
                `${openThreads.length} open`,
              ]
                .filter(Boolean)
                .join(" · ")}
        </span>
        {/* The only other way out is the Comments chip in the top bar,
            which on a tablet is a small target on the far side of the
            screen from the panel it closes. */}
        <IconButton
          icon={X}
          label="Close comments"
          iconSize={15}
          className="canvas-comments-close"
          onClick={onClose}
        />
      </header>
      {threads.length === 0 ? (
        <div className="canvas-comments-empty">
          <MessageSquarePlus size={20} aria-hidden="true" />
          <p>Nothing on this Page yet.</p>
          <p>
            Press <kbd>C</kbd> and click a screen to leave the first note. Your agent reads open
            ones over MCP and answers here.
          </p>
        </div>
      ) : (
        <div className="canvas-comment-groups">
          {groups.map((group) => (
            <section className="canvas-comment-section" key={group.key}>
              {/* Always headed: the section is what says whether a thread
                  is waiting on the reader or on the agent. */}
              <h3>
                {group.title}
                <span className="canvas-comment-section-count">{group.items.length}</span>
              </h3>
              <ul className="canvas-comment-list">{group.items.map(renderThread)}</ul>
            </section>
          ))}
          {resolved.length > 0 && (
            /* Done, and folded away: the panel is a to-do list, not an
               archive, but the archive is one click below it. */
            <Disclosure
              className="canvas-comments-resolved"
              summary={`Resolved · ${resolved.length}`}
            >
              <ul className="canvas-comment-list">{resolved.map(renderThread)}</ul>
            </Disclosure>
          )}
        </div>
      )}
    </aside>
  );
}
