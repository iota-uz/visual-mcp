import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CanvasFile } from "@visual-canvas/canvas";
import { describe, expect, test, vi } from "vitest";
import { PagesPanel, VersionHistory } from "./Canvas";

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
  useQuery: () => undefined,
}));

// jsdom has no PointerEvent constructor; MouseEvent supplies the coordinates
// and button semantics this pointer-driven drag interaction needs.
Object.defineProperty(window, "PointerEvent", { configurable: true, value: MouseEvent });

function canvasFile(): CanvasFile {
  const doc = (title: string) => ({
    version: 2 as const,
    title,
    world: { width: 800, height: 500 },
    lanes: [],
    stages: [],
    labels: [],
    nodes: [],
    edges: [],
  });
  return {
    version: 3,
    defaultPageId: "overview",
    pages: [
      { id: "overview", title: "Overview", order: 0, doc: doc("Overview") },
      {
        id: "product-architecture",
        title: "01 · Схема продукта",
        order: 1,
        doc: doc("Architecture"),
      },
    ],
    prototype: { interactions: [] },
  };
}

describe("PagesPanel", () => {
  test("selects the requested Page and requires a named confirmation before deletion", async () => {
    const onSelect = vi.fn();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <PagesPanel
        file={canvasFile()}
        activePageId="overview"
        collapsed={false}
        onCollapsedChange={() => {}}
        onSelect={onSelect}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "01 · Схема продукта" }));
    expect(onSelect).toHaveBeenCalledWith("product-architecture");

    fireEvent.click(screen.getByRole("button", { name: "More actions for 01 · Схема продукта" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete Page…" }));
    expect(onSave).not.toHaveBeenCalled();
    const confirmation = screen.getByRole("group", {
      name: "Confirm deletion of 01 · Схема продукта",
    });
    expect(confirmation).toHaveTextContent("Delete “01 · Схема продукта”?");

    fireEvent.click(within(confirmation).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const saved = onSave.mock.calls[0]?.[0] as CanvasFile;
    expect(saved.pages.map((page) => page.id)).toEqual(["overview"]);
  });

  test("renames on title double click and reorders with the drag handle", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <PagesPanel
        file={canvasFile()}
        activePageId="overview"
        collapsed={false}
        onCollapsedChange={() => {}}
        onSelect={() => {}}
        onSave={onSave}
      />,
    );

    fireEvent.doubleClick(screen.getByRole("button", { name: "Overview default" }));
    const input = screen.getByRole("textbox", { name: "Rename Overview" });
    fireEvent.change(input, { target: { value: "Summary" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const renamed = onSave.mock.calls[0]?.[0] as CanvasFile | undefined;
    expect(renamed?.pages[0]?.title).toBe("Summary");

    onSave.mockClear();
    rerender(
      <PagesPanel
        file={canvasFile()}
        activePageId="overview"
        collapsed={false}
        onCollapsedChange={() => {}}
        onSelect={() => {}}
        onSave={onSave}
      />,
    );
    const handle = screen.getByRole("button", {
      name: "Drag to reorder 01 · Схема продукта",
    });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const reordered = onSave.mock.calls[0]?.[0] as CanvasFile | undefined;
    expect(reordered?.pages.map((page) => page.id)).toEqual(["product-architecture", "overview"]);
  });

  test("reorders Pages by dragging the six-dot handle", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <PagesPanel
        file={canvasFile()}
        activePageId="overview"
        collapsed={false}
        onCollapsedChange={() => {}}
        onSelect={() => {}}
        onSave={onSave}
      />,
    );

    const handle = screen.getByRole("button", { name: "Drag to reorder Overview" });
    const target = screen.getByRole("button", { name: "01 · Схема продукта" }).closest("li");
    if (!target) throw new Error("Expected the target Page row");
    Object.defineProperty(target, "getBoundingClientRect", {
      value: () => ({ top: 0, height: 40 }),
    });
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => target,
    });

    fireEvent.pointerDown(handle, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(document, { clientX: 10, clientY: 39, pointerId: 1 });
    fireEvent.pointerUp(document, { clientX: 10, clientY: 39, pointerId: 1 });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const reordered = onSave.mock.calls[0]?.[0] as CanvasFile | undefined;
    expect(reordered?.pages.map((page) => page.id)).toEqual(["product-architecture", "overview"]);
  });

  test("offers the current checkpoint as a recovery source while the draft is dirty", () => {
    const version = {
      versionId: "v1",
      version: 1,
      createdAt: Date.now(),
      createdByEmail: "agent@iota.uz",
      isCurrent: true,
    };
    const { rerender } = render(
      <VersionHistory canvasId={"canvas" as never} versions={[version]} dirty={false} />,
    );
    expect(screen.queryByRole("button", { name: "Restore" })).toBeNull();

    rerender(<VersionHistory canvasId={"canvas" as never} versions={[version]} dirty />);
    expect(screen.getByRole("button", { name: "Restore" })).toBeVisible();
  });
});
