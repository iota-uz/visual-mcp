import type { CanvasDoc } from "@visual-canvas/canvas";

/**
 * One conversation pinned to a Page — the shape `comments.listMine` returns
 * and the shape the MCP `comment_*` tools write. A thread is either about a
 * node (`node_id`) or about a spot on the page (`point`), never both.
 */
export interface CommentThread {
  comment_id: string;
  page_id: string;
  node_id?: string;
  point?: { x: number; y: number };
  body: string;
  status: "open" | "completed" | "resolved";
  author_kind: "human" | "agent";
  created_at: number;
  completion?: { summary: string; version: number; draft_revision: number; at: number };
  replies: Array<{
    reply_id: string;
    body: string;
    author_kind: "human" | "agent";
    created_at: number;
  }>;
}

/** A comment that has been placed but not yet written. */
export interface CommentDraft {
  nodeId?: string;
  point: { x: number; y: number };
}

/*
 * What the comment is about, in the words on screen: a node's own caption,
 * not its id. "On Intake" is a comment about something; "On node_3" is a
 * database row.
 */
export function commentAnchorLabel(doc: CanvasDoc | null, nodeId: string | undefined): string {
  if (!nodeId) return "On this page";
  const title = doc?.nodes.find((node) => node.id === nodeId)?.caption.title;
  // A node can be deleted out from under a thread. Saying so beats a pin
  // that silently stands for nothing.
  return title ? `On ${title}` : `On ${nodeId} (deleted)`;
}

/* Workspaces have one person in them, so a human comment is this reader's
   own. When that stops being true this is where a name goes. */
export function commentAuthor(kind: "human" | "agent"): string {
  return kind === "agent" ? "Agent" : "You";
}
