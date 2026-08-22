import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CanvasDoc } from "@visual-canvas/canvas";
import { describe, expect, test, vi } from "vitest";
import { CommentsPanel, type CommentThread } from "./Canvas";

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
  useQuery: () => undefined,
}));

function doc(): CanvasDoc {
  return {
    version: 2,
    title: "Claims",
    world: { width: 800, height: 500 },
    lanes: [],
    stages: [],
    labels: [],
    groups: [],
    edges: [],
    nodes: [
      {
        id: "intake",
        kind: "native",
        shape: "note",
        rect: { x: 0, y: 0, w: 100, h: 60 },
        caption: { title: "Intake" },
        anchors: [{ id: "left", side: "left", offset: 0.5 }],
      },
    ],
  };
}

function thread(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    comment_id: "c1",
    page_id: "overview",
    node_id: "intake",
    body: "Make the CTA primary",
    status: "open",
    author_kind: "human",
    created_at: 1,
    replies: [],
    ...overrides,
  };
}

function panel(props: Partial<Parameters<typeof CommentsPanel>[0]> = {}) {
  const handlers = {
    onDraftChange: vi.fn(),
    onActiveChange: vi.fn(),
    onCreate: vi.fn().mockResolvedValue(undefined),
    onReply: vi.fn().mockResolvedValue(undefined),
    onStatus: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <CommentsPanel
      threads={[thread()]}
      doc={doc()}
      draft={null}
      activeId={null}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("CommentsPanel", () => {
  test("a draft names what it is anchored to and posts against that anchor", async () => {
    const handlers = panel({ draft: { nodeId: "intake", point: { x: 10, y: 20 } } });
    // The node's caption, not its id: the point of anchoring is that the
    // person can see what they are about to talk about.
    expect(screen.getByText("On Intake")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Rename this" } });
    fireEvent.click(screen.getByRole("button", { name: "Comment" }));

    await waitFor(() =>
      expect(handlers.onCreate).toHaveBeenCalledWith({
        nodeId: "intake",
        point: { x: 10, y: 20 },
        body: "Rename this",
      }),
    );
  });

  test("an empty comment cannot be posted", () => {
    panel({ draft: { point: { x: 40, y: 80 } } });
    expect(screen.getByText(/On this page · 40, 80/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Comment" })).toBeDisabled();
  });

  test("a completed thread shows the summary and the revision to go and look at", () => {
    panel({
      threads: [
        thread({
          status: "completed",
          completion: { summary: "Renamed it to Intake", version: 7, draft_revision: 3, at: 2 },
        }),
      ],
      activeId: "c1",
    });

    // A completed thread is not "open": it is waiting on the reader, and
    // the header says which of the two it is — as does the section it is
    // filed under, which is why the row itself carries no status label.
    expect(screen.getByText("0 open · 1 awaiting you")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: /Needs you/ })).toBeInTheDocument();
    expect(screen.getByText("Renamed it to Intake")).toBeInTheDocument();
    // The block is always the agent's, so it names the revision and when,
    // not who, for the third time in one card.
    expect(screen.getByText(/v7 · draft 3 ·/)).toBeInTheDocument();
    // Both directions are available: accept it, or send it back.
    expect(screen.getByRole("button", { name: /Resolve/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Not done/ })).toBeInTheDocument();
  });

  test("resolving and reopening are the person's two answers", async () => {
    const handlers = panel({ threads: [thread()], activeId: "c1" });
    fireEvent.click(screen.getByRole("button", { name: /Resolve/ }));
    await waitFor(() => expect(handlers.onStatus).toHaveBeenCalledWith("c1", "resolved"));

    handlers.onStatus.mockClear();
    render(
      <CommentsPanel
        threads={[thread({ status: "resolved" })]}
        doc={doc()}
        draft={null}
        activeId="c1"
        {...handlers}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /Reopen/ })[0] as HTMLElement);
    await waitFor(() => expect(handlers.onStatus).toHaveBeenCalledWith("c1", "open"));
  });

  test("a thread whose node was deleted says so instead of vanishing", () => {
    panel({ threads: [thread({ node_id: "gone" })] });
    expect(screen.getByText("gone (deleted)")).toBeInTheDocument();
  });

  test("replies are listed with who wrote them and can be added", async () => {
    const handlers = panel({
      threads: [
        thread({
          replies: [
            { reply_id: "r1", body: "Renaming it now.", author_kind: "agent", created_at: 2 },
          ],
        }),
      ],
      activeId: "c1",
    });
    const replies = document.querySelector(".canvas-comment-replies");
    if (!replies) throw new Error("Missing replies list");
    expect(within(replies as HTMLElement).getByText("Renaming it now.")).toBeInTheDocument();
    expect(within(replies as HTMLElement).getByText("Agent")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Reply to this comment" }), {
      target: { value: "Thanks" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reply" }));
    await waitFor(() => expect(handlers.onReply).toHaveBeenCalledWith("c1", "Thanks"));
  });

  test("a thread says who left it and when", () => {
    const minutesAgo = Date.now() - 12 * 60_000;
    panel({
      threads: [
        thread({
          created_at: minutesAgo,
          replies: [
            { reply_id: "r1", body: "On it.", author_kind: "agent", created_at: minutesAgo },
          ],
        }),
      ],
      activeId: "c1",
    });
    // A single-person workspace, so a human comment is the reader's own.
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getAllByText("12m ago")).toHaveLength(2);
  });

  test("the list separates what needs an answer from what is done", () => {
    panel({
      threads: [
        thread({ comment_id: "c1", body: "Still open" }),
        thread({
          comment_id: "c2",
          body: "Claimed done",
          status: "completed",
          completion: { summary: "Renamed it", version: 7, draft_revision: 3, at: 2 },
        }),
        thread({ comment_id: "c3", body: "Long settled", status: "resolved" }),
      ],
    });
    // Needs-you comes first: it is the only bucket waiting on this reader.
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["Needs you1", "Open1"]);
    // History folds away rather than padding the to-do list.
    const resolved = document.querySelector(".canvas-comments-resolved");
    if (!resolved) throw new Error("Missing resolved disclosure");
    expect(resolved).not.toHaveAttribute("open");
    expect(within(resolved as HTMLElement).getByText("Long settled")).toBeInTheDocument();
  });

  test("a collapsed thread shows only what identifies it", () => {
    const handlers = panel({
      threads: [
        thread({
          status: "completed",
          completion: { summary: "Renamed it to Intake", version: 7, draft_revision: 3, at: 2 },
          replies: [{ reply_id: "r1", body: "On it.", author_kind: "agent", created_at: 2 }],
        }),
      ],
    });
    // Who, when, where, what it says — and how much more there is.
    expect(screen.getByText("Make the CTA primary")).toBeInTheDocument();
    expect(screen.getByText("1 reply")).toBeInTheDocument();
    // The agent's claim, the conversation and the buttons wait for a click.
    expect(screen.queryByText("Renamed it to Intake")).not.toBeInTheDocument();
    expect(screen.queryByText("On it.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resolve/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(handlers.onActiveChange).toHaveBeenCalledWith("c1");
  });
});
