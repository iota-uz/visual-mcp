import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { CommentComposerPopover, CommentThreadPopover } from "./CommentPopover";
import type { CommentThread } from "./types";

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

function threadPopover(overrides: Partial<CommentThread> = {}) {
  const handlers = {
    onReply: vi.fn().mockResolvedValue(undefined),
    onStatus: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onClose: vi.fn(),
  };
  render(<CommentThreadPopover thread={thread(overrides)} anchorLabel="On Intake" {...handlers} />);
  return handlers;
}

describe("CommentComposerPopover", () => {
  test("names what it is anchored to and posts what was typed", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <CommentComposerPopover anchorLabel="On Intake" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    // The node's caption, not its id: the point of anchoring is that the
    // person can see what they are about to talk about.
    expect(screen.getByText("On Intake")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Comment" }), {
      target: { value: "Rename this" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Rename this"));
  });

  test("an empty comment cannot be posted", () => {
    render(
      <CommentComposerPopover anchorLabel="On this page" onSubmit={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Post comment" })).toBeDisabled();
  });

  test("Enter posts and Shift+Enter does not", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <CommentComposerPopover anchorLabel="On Intake" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    const field = screen.getByRole("textbox", { name: "Comment" });
    fireEvent.change(field, { target: { value: "Rename this" } });

    fireEvent.keyDown(field, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("Rename this");
  });

  test("the box collapses back to one row once the comment is sent", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <CommentComposerPopover anchorLabel="On Intake" onSubmit={onSubmit} onCancel={vi.fn()} />,
    );
    const field = screen.getByRole("textbox", { name: "Comment" });
    fireEvent.change(field, { target: { value: "one\ntwo\nthree" } });
    // Grown to fit what was typed, then measured again from empty.
    expect(field).toHaveAttribute("style", expect.stringContaining("px"));

    fireEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() => expect(field).toHaveValue(""));
    expect(field.style.height).toBe("auto");
  });

  test("closing hands the keyboard back to the canvas", () => {
    // The canvas listens for its shortcuts on the viewport container; focus
    // stranded on <body> makes every one of them dead.
    const viewport = document.createElement("div");
    viewport.className = "vc-viewport";
    viewport.tabIndex = 0;
    document.body.append(viewport);
    const view = render(
      <CommentComposerPopover anchorLabel="On Intake" onSubmit={vi.fn()} onCancel={vi.fn()} />,
      { container: viewport },
    );
    view.unmount();
    expect(document.activeElement).toBe(viewport);
    viewport.remove();
  });

  test("Escape discards the draft", () => {
    const onCancel = vi.fn();
    render(
      <CommentComposerPopover anchorLabel="On Intake" onSubmit={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("CommentThreadPopover", () => {
  test("reads as a conversation, newest last, with who said what", () => {
    threadPopover({
      replies: [{ reply_id: "r1", body: "Renaming it now.", author_kind: "agent", created_at: 2 }],
    });
    const messages = screen.getAllByRole("listitem");
    expect(within(messages[0] as HTMLElement).getByText("You")).toBeInTheDocument();
    expect(
      within(messages[0] as HTMLElement).getByText("Make the CTA primary"),
    ).toBeInTheDocument();
    expect(within(messages[1] as HTMLElement).getByText("Agent")).toBeInTheDocument();
    expect(within(messages[1] as HTMLElement).getByText("Renaming it now.")).toBeInTheDocument();
  });

  test("a reply is posted against this thread", async () => {
    const handlers = threadPopover();
    fireEvent.change(screen.getByRole("textbox", { name: "Reply to this comment" }), {
      target: { value: "Thanks" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }));
    await waitFor(() => expect(handlers.onReply).toHaveBeenCalledWith("Thanks"));
  });

  test("an open thread can be resolved from the header", async () => {
    const handlers = threadPopover();
    fireEvent.click(screen.getByRole("button", { name: "Resolve thread" }));
    await waitFor(() => expect(handlers.onStatus).toHaveBeenCalledWith("resolved"));
  });

  test("the agent's claim is answered where the claim is", async () => {
    const handlers = threadPopover({
      status: "completed",
      completion: { summary: "Renamed it to Intake", version: 7, draft_revision: 3, at: 2 },
    });
    expect(screen.getByText("Renamed it to Intake")).toBeInTheDocument();
    // The revision is the point of `completed`: it says what to go and look at.
    expect(screen.getByText(/v7 · draft 3/)).toBeInTheDocument();
    // Both answers, and no generic Resolve competing with them.
    expect(screen.queryByRole("button", { name: "Resolve thread" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Not done/ }));
    await waitFor(() => expect(handlers.onStatus).toHaveBeenCalledWith("open"));

    fireEvent.click(screen.getByRole("button", { name: /Looks right/ }));
    await waitFor(() => expect(handlers.onStatus).toHaveBeenCalledWith("resolved"));
  });

  test("a resolved thread offers reopening instead of a reply nobody reads", async () => {
    const handlers = threadPopover({ status: "resolved" });
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reopen to reply/ }));
    await waitFor(() => expect(handlers.onStatus).toHaveBeenCalledWith("open"));
  });

  test("deleting takes two clicks", async () => {
    const handlers = threadPopover();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete comment/ }));
    expect(handlers.onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: /Really delete\?/ }));
    await waitFor(() => expect(handlers.onDelete).toHaveBeenCalled());
  });

  test("a failed action is reported in the card, not swallowed", async () => {
    render(
      <CommentThreadPopover
        thread={thread()}
        anchorLabel="On Intake"
        onReply={vi.fn().mockRejectedValue(new Error("Comment body is required."))}
        onStatus={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Reply to this comment" }), {
      target: { value: "Thanks" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post reply" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Comment body is required.");
  });
});
