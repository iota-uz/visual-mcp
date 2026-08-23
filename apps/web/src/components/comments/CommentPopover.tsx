import { Check, MoreHorizontal, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatAbsoluteTime, formatRelativeTime } from "../../lib/formatDate";
import { IconButton } from "../ui/IconButton";
import {
  CommentAvatar,
  CommentInput,
  CommentSendButton,
  useCommentAction,
  useDismissOnEscape,
} from "./CommentPieces";
import { type CommentThread, commentAuthor } from "./types";

/*
 * Comments happen where the thing being commented on is. Both cards here
 * are portalled into a host the viewport positions against a pin, so the
 * conversation sits over the drawing at the place it is about — the way it
 * does in every canvas tool people already know — instead of in a rail on
 * the far side of the screen with a line of prose naming the anchor.
 */

/**
 * A menu of the actions that are not the primary one. Open state belongs to
 * the card so that Escape closes the menu before it closes the card — one
 * dismissal per press, in the order they are stacked.
 */
function ThreadMenu({
  items,
  open,
  onOpenChange,
}: {
  items: Array<{
    key: string;
    label: string;
    icon: typeof Trash2;
    danger?: boolean;
    run: () => void;
  }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setOpen = onOpenChange;
  const wrap = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);

  useEffect(() => {
    if (!open) setArmed(null);
  }, [open]);

  return (
    <div className="comment-menu" ref={wrap}>
      <IconButton
        icon={MoreHorizontal}
        iconSize={15}
        label="More actions"
        className="comment-icon-button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="comment-menu-list" role="menu">
          {items.map((item) => {
            // Destructive items arm in place: a menu that deletes on the
            // first click is one stray press away from losing a thread,
            // and a modal over a popover is two dismissals deep.
            const isArmed = armed === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                role="menuitem"
                data-danger={item.danger ? "" : undefined}
                data-armed={isArmed ? "" : undefined}
                onClick={() => {
                  if (item.danger && !isArmed) {
                    setArmed(item.key);
                    return;
                  }
                  setOpen(false);
                  item.run();
                }}
              >
                <Icon size={14} aria-hidden="true" />
                {isArmed ? "Really delete?" : item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PopoverShell({
  kind,
  children,
}: {
  kind: "composer" | "thread";
  children: React.ReactNode;
}) {
  const card = useRef<HTMLDivElement>(null);

  // Hand the keyboard back on the way out. The card is closed with the focus
  // inside it, and focus that falls to <body> leaves the canvas shortcuts
  // dead until the next click on the drawing.
  useEffect(() => {
    const viewport = card.current?.closest<HTMLElement>(".vc-viewport") ?? null;
    return () => {
      const active = document.activeElement;
      const leaving = !active || active === document.body || card.current?.contains(active);
      if (leaving) viewport?.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      ref={card}
      className="comment-pop"
      data-kind={kind}
      // Non-modal, but a dialog: it owns the keyboard while it is open. The
      // canvas below listens for the letter keys that switch tools and for
      // Delete, and neither may fire from inside a comment.
      role="dialog"
      aria-label={kind === "composer" ? "New comment" : "Comment thread"}
      /* Clicking the card's own padding must not fall through to the
         canvas: the viewport container is focusable, so without this the
         browser hands it the focus and the next keystroke switches tools. */
      tabIndex={-1}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

/**
 * The composer. One field, one send button, and the name of what is being
 * commented on — nothing that has to be read before typing.
 */
export function CommentComposerPopover({
  anchorLabel,
  onSubmit,
  onCancel,
}: {
  anchorLabel: string;
  onSubmit: (body: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const { busy, error, run } = useCommentAction();
  useDismissOnEscape(onCancel);

  async function send() {
    const text = body.trim();
    if (!text || busy) return;
    if (await run(() => onSubmit(text), "Couldn't post the comment.")) setBody("");
  }

  return (
    <PopoverShell kind="composer">
      <form
        className="comment-pop-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <p className="comment-pop-anchor">{anchorLabel}</p>
        <div className="comment-pop-field">
          <CommentAvatar kind="human" size={24} />
          <CommentInput
            autoFocus
            value={body}
            onChange={setBody}
            onSubmit={() => void send()}
            label="Comment"
            placeholder="Ask for a change…"
          />
          <CommentSendButton label="Post comment" disabled={body.trim().length === 0} busy={busy} />
        </div>
        {/* The hint appears when it becomes true — an empty composer has
            nothing to post, and a permanent line of instructions under a
            one-field form is furniture. */}
        {error ? (
          <p className="comment-pop-error" role="alert">
            {error}
          </p>
        ) : body.trim().length > 0 ? (
          <p className="comment-pop-hint">
            <kbd>Enter</kbd> to post · <kbd>Shift+Enter</kbd> for a line break
          </p>
        ) : null}
      </form>
    </PopoverShell>
  );
}

function Message({ kind, at, body }: { kind: "human" | "agent"; at: number; body: string }) {
  return (
    <li className="comment-message" data-author={kind}>
      <CommentAvatar kind={kind} size={22} />
      <div>
        <p className="comment-message-head">
          <strong>{commentAuthor(kind)}</strong>
          <time dateTime={new Date(at).toISOString()} title={formatAbsoluteTime(at)}>
            {formatRelativeTime(at)}
          </time>
        </p>
        <p className="comment-message-body">{body}</p>
      </div>
    </li>
  );
}

/**
 * A thread, open on the canvas. The one state this has that a
 * person-to-person commenting tool does not is `completed`: the agent says
 * it has done the work and the thread is now waiting on a verdict. That
 * verdict is asked for where the claim is, in the claim's own words, rather
 * than as a generic Resolve button among the others.
 */
export function CommentThreadPopover({
  thread,
  anchorLabel,
  onReply,
  onStatus,
  onDelete,
  onClose,
}: {
  thread: CommentThread;
  anchorLabel: string;
  onReply: (body: string) => Promise<unknown>;
  onStatus: (status: "resolved" | "open") => Promise<unknown>;
  onDelete: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [reply, setReply] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const { busy, error, run } = useCommentAction();
  useDismissOnEscape(() => (menuOpen ? setMenuOpen(false) : onClose()));

  // A conversation opens at its newest message, not its oldest: the reply
  // that arrived while you were away is the reason you opened the thread.
  const messages = useRef<HTMLUListElement>(null);
  const count = thread.replies.length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new reply is the reason to re-scroll
  useLayoutEffect(() => {
    const list = messages.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [count]);

  async function send() {
    const text = reply.trim();
    if (!text || busy) return;
    if (await run(() => onReply(text), "Couldn't post the reply.")) setReply("");
  }

  const resolved = thread.status === "resolved";
  const menuItems = [
    {
      key: "delete",
      label: "Delete comment",
      icon: Trash2,
      danger: true,
      run: () => void run(onDelete, "Couldn't delete the comment."),
    },
  ];

  return (
    <PopoverShell kind="thread">
      <header className="comment-pop-head">
        <span className="comment-pop-anchor" title={anchorLabel}>
          {anchorLabel}
        </span>
        {resolved && <span className="comment-pop-status">Resolved</span>}
        {!resolved && thread.status === "open" && (
          <IconButton
            icon={Check}
            iconSize={15}
            label="Resolve thread"
            title="Resolve"
            className="comment-icon-button"
            disabled={busy}
            onClick={() => void run(() => onStatus("resolved"), "Couldn't resolve the thread.")}
          />
        )}
        <ThreadMenu items={menuItems} open={menuOpen} onOpenChange={setMenuOpen} />
        <IconButton
          icon={X}
          iconSize={15}
          label="Close thread"
          className="comment-icon-button"
          onClick={onClose}
        />
      </header>

      <ul className="comment-pop-messages" ref={messages}>
        <Message kind={thread.author_kind} at={thread.created_at} body={thread.body} />
        {thread.replies.map((entry) => (
          <Message
            key={entry.reply_id}
            kind={entry.author_kind}
            at={entry.created_at}
            body={entry.body}
          />
        ))}
      </ul>

      {thread.status === "completed" && thread.completion && (
        <div className="comment-completion">
          <p className="comment-completion-head">
            <Sparkles size={13} aria-hidden="true" />
            {thread.completion.summary}
          </p>
          <p className="comment-completion-meta">
            Agent · v{thread.completion.version} · draft {thread.completion.draft_revision} ·{" "}
            <time
              dateTime={new Date(thread.completion.at).toISOString()}
              title={formatAbsoluteTime(thread.completion.at)}
            >
              {formatRelativeTime(thread.completion.at)}
            </time>
          </p>
          {/* Two answers, both plain: accept the work, or send it back. */}
          <div className="comment-completion-verdict">
            <button
              type="button"
              className="comment-verdict"
              data-tone="accept"
              disabled={busy}
              onClick={() => void run(() => onStatus("resolved"), "Couldn't resolve the thread.")}
            >
              <Check size={13} aria-hidden="true" />
              Looks right
            </button>
            <button
              type="button"
              className="comment-verdict"
              disabled={busy}
              onClick={() => void run(() => onStatus("open"), "Couldn't reopen the thread.")}
            >
              <RotateCcw size={13} aria-hidden="true" />
              Not done
            </button>
          </div>
        </div>
      )}

      {/* A reply onto a settled thread is a message nobody is coming back
          for, so a resolved thread offers the one move that makes replying
          mean something again. */}
      {resolved ? (
        <button
          type="button"
          className="comment-verdict comment-pop-reopen"
          disabled={busy}
          onClick={() => void run(() => onStatus("open"), "Couldn't reopen the thread.")}
        >
          <RotateCcw size={13} aria-hidden="true" />
          Reopen to reply
        </button>
      ) : (
        <form
          className="comment-pop-field comment-pop-reply"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <CommentAvatar kind="human" size={22} />
          <CommentInput
            value={reply}
            onChange={setReply}
            onSubmit={() => void send()}
            label="Reply to this comment"
            placeholder="Reply…"
            maxRows={5}
          />
          <CommentSendButton label="Post reply" disabled={reply.trim().length === 0} busy={busy} />
        </form>
      )}

      {error && (
        <p className="comment-pop-error" role="alert">
          {error}
        </p>
      )}
    </PopoverShell>
  );
}
