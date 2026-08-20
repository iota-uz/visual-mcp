import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { CanvasFile } from "@visual-canvas/canvas";
import { describe, expect, test, vi } from "vitest";
import { PagesPanel, VersionHistory } from "./Canvas";

vi.mock("convex/react", () => ({
  useAction: () => vi.fn(),
  useMutation: () => vi.fn(),
  useQuery: () => undefined,
}));

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

    fireEvent.click(screen.getByRole("button", { name: "Delete 01 · Схема продукта" }));
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
