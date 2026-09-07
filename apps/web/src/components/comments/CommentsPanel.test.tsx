import { fireEvent, render, screen, within } from "@testing-library/react";
import type { CanvasDoc } from "@visual-canvas/canvas";
import { describe, expect, test, vi } from "vitest";
import { CommentsPanel } from "./CommentsPanel";
import type { CommentThread } from "./types";

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
    drawings: [],
    notes: [],
    nodes: [
      {
        id: "intake",
        kind: "native",
        shape: "card",
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
  const handlers = { onActiveChange: vi.fn(), onClose: vi.fn() };
  render(
    <CommentsPanel threads={[thread()]} doc={doc()} activeId={null} {...handlers} {...props} />,
  );
  return handlers;
}

describe("CommentsPanel", () => {
  test("a row names the node it is about by its caption, not its id", () => {
    panel();
    expect(screen.getByText("On Intake")).toBeInTheDocument();
  });

  test("a thread whose node was deleted says so instead of vanishing", () => {
    panel({ threads: [thread({ node_id: "gone" })] });
    expect(screen.getByText("On gone (deleted)")).toBeInTheDocument();
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
    expect(screen.getByText("1 awaiting you · 1 open")).toBeInTheDocument();
    // History folds away rather than padding the to-do list.
    const resolved = document.querySelector(".canvas-comments-resolved");
    if (!resolved) throw new Error("Missing resolved disclosure");
    expect(resolved).not.toHaveAttribute("open");
    expect(within(resolved as HTMLElement).getByText("Long settled")).toBeInTheDocument();
  });

  test("a completed row shows the agent's claim, which is what it is waiting on", () => {
    panel({
      threads: [
        thread({
          status: "completed",
          completion: { summary: "Renamed it to Intake", version: 7, draft_revision: 3, at: 2 },
        }),
      ],
    });
    expect(screen.getByText("Renamed it to Intake")).toBeInTheDocument();
    expect(screen.getByText("Agent:")).toBeInTheDocument();
  });

  test("a row shows the last thing said in the thread", () => {
    panel({
      threads: [
        thread({
          replies: [
            { reply_id: "r1", body: "Renaming it now.", author_kind: "agent", created_at: 2 },
          ],
        }),
      ],
    });
    expect(screen.getByText("Renaming it now.")).toBeInTheDocument();
    expect(screen.getByText("Agent:")).toBeInTheDocument();
  });

  test("clicking a row opens that thread on the canvas", () => {
    const handlers = panel();
    fireEvent.click(screen.getByRole("button", { pressed: false }));
    expect(handlers.onActiveChange).toHaveBeenCalledWith("c1");
  });

  test("clicking the row of the open thread closes it", () => {
    const handlers = panel({ activeId: "c1" });
    fireEvent.click(screen.getByRole("button", { pressed: true }));
    expect(handlers.onActiveChange).toHaveBeenCalledWith(null);
  });

  test("an empty Page says how to start", () => {
    panel({ threads: [] });
    expect(screen.getByText("Nothing on this Page yet.")).toBeInTheDocument();
    expect(screen.getByText("None yet")).toBeInTheDocument();
  });
});
