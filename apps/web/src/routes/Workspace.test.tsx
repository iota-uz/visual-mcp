import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ToastProvider } from "../components/Toast";
import { WorkspacePage } from "./Workspace";

/*
 * The gallery is where a canvas is renamed or destroyed, and until this page
 * grew a ⋯ menu neither was reachable outside the canvas itself. These cover
 * the wiring that makes that safe: which mutation runs, what the card says
 * before it runs, and that the filter cannot hide the way back out.
 */

const { useQueryMock, useMutationMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  useMutationMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
}));

const WORKSPACE = { workspace_id: "ws1", slug: "osago", name: "OSAGO", description: undefined };

function canvas(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    canvas_id: "c1",
    slug: "claim-intake",
    title: "Claim intake",
    kind: "canvas",
    visibility: "private",
    updated_at: Date.now(),
    thumbnail_url: null,
    static_render_status: "ready",
    ...overrides,
  };
}

/** `getBySlug` takes a slug; `listForWorkspace` takes a workspace id. */
function backend(workspace: unknown, canvases: unknown) {
  useQueryMock.mockImplementation((_ref: unknown, args: unknown) => {
    if (args && typeof args === "object" && "slug" in args) return workspace;
    if (args === "skip") return undefined;
    return canvases;
  });
}

function renderWorkspace() {
  return render(
    <MemoryRouter initialEntries={["/w/osago"]}>
      <ToastProvider>
        <Routes>
          <Route path="/w/:wsSlug" element={<WorkspacePage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
}

const menuFor = (title: string) => screen.getByRole("button", { name: `Actions for ${title}` });

describe("WorkspacePage", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useMutationMock.mockReturnValue(vi.fn().mockResolvedValue({ bytes_reclaimed: 0 }));
  });

  test("treats canvases, videos and assets as peer collections", () => {
    backend(WORKSPACE, [canvas()]);
    renderWorkspace();
    const collections = screen.getByRole("navigation", { name: "Workspace collections" });
    expect(within(collections).getByRole("link", { name: "Canvases" })).toHaveAttribute(
      "href",
      "/w/osago",
    );
    expect(within(collections).getByRole("link", { name: "Videos" })).toHaveAttribute(
      "href",
      "/w/osago/videos",
    );
    expect(within(collections).getByRole("link", { name: "Assets" })).toHaveAttribute(
      "href",
      "/w/osago/assets",
    );
  });

  test("offers the way back to the workspace list", () => {
    backend(WORKSPACE, [canvas()]);
    renderWorkspace();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Workspaces" })).toHaveAttribute("href", "/");
  });

  test("names the canvas count when the workspace has no description", () => {
    backend(WORKSPACE, [canvas(), canvas({ canvas_id: "c2", title: "Fast settlement" })]);
    renderWorkspace();
    expect(screen.getByText("2 canvases")).toBeInTheDocument();
  });

  test("the whole card is one link, named by the canvas", () => {
    backend(WORKSPACE, [canvas()]);
    renderWorkspace();
    expect(screen.getByRole("link", { name: "Claim intake" })).toHaveAttribute("href", "/c/c1");
  });

  test("the kind is a chip a screen reader can still read", () => {
    backend(WORKSPACE, [canvas()]);
    renderWorkspace();
    // The chip is 22px of artwork overlay: the word is there for assistive
    // tech, not laid over the picture as it used to be.
    expect(screen.getByText("canvas")).toHaveClass("visually-hidden");
  });

  test("filters on title, and leaves a way back to the full list", async () => {
    const user = userEvent.setup();
    backend(WORKSPACE, [canvas(), canvas({ canvas_id: "c2", title: "Fast settlement" })]);
    renderWorkspace();

    await user.type(screen.getByPlaceholderText("Filter canvases…"), "fast");
    expect(screen.queryByRole("link", { name: "Claim intake" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fast settlement" })).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Filter canvases…"), "zzz");
    await user.click(screen.getByRole("button", { name: "Show all canvases" }));
    expect(screen.getByRole("link", { name: "Claim intake" })).toBeInTheDocument();
  });

  test("sorts by title on request", async () => {
    const user = userEvent.setup();
    backend(WORKSPACE, [
      canvas({ canvas_id: "c1", title: "Zebra", updated_at: 2 }),
      canvas({ canvas_id: "c2", title: "Alpha", updated_at: 1 }),
    ]);
    renderWorkspace();

    expect(screen.getAllByRole("link", { name: /Zebra|Alpha/ })[0]).toHaveTextContent("Zebra");
    await user.selectOptions(screen.getByLabelText("Sort canvases"), "title");
    expect(screen.getAllByRole("link", { name: /Zebra|Alpha/ })[0]).toHaveTextContent("Alpha");
  });

  test("renames the workspace on title double-click", async () => {
    const user = userEvent.setup();
    const rename = vi.fn().mockResolvedValue({ name: "OSAGO v2" });
    useMutationMock.mockReturnValue(rename);
    backend(WORKSPACE, [canvas()]);
    renderWorkspace();

    await user.dblClick(screen.getByRole("button", { name: "OSAGO" }));
    const field = screen.getByRole("textbox", { name: "Workspace name" });
    await user.clear(field);
    await user.type(field, "  OSAGO v2{Enter}");
    expect(rename).toHaveBeenCalledWith({ workspaceId: "ws1", name: "OSAGO v2" });
  });

  test("cancels a workspace rename on Escape and ignores an empty name", async () => {
    const user = userEvent.setup();
    const rename = vi.fn().mockResolvedValue({ name: "Nope" });
    useMutationMock.mockReturnValue(rename);
    backend(WORKSPACE, [canvas()]);
    renderWorkspace();

    await user.dblClick(screen.getByRole("button", { name: "OSAGO" }));
    await user.type(screen.getByRole("textbox", { name: "Workspace name" }), "Nope{Escape}");
    expect(rename).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "OSAGO" })).toBeInTheDocument();

    screen.getByRole("button", { name: "OSAGO" }).focus();
    await user.keyboard("{F2}");
    const field = screen.getByRole("textbox", { name: "Workspace name" });
    await user.clear(field);
    await user.keyboard("{Enter}");
    expect(rename).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "OSAGO" })).toBeInTheDocument();
  });

  test("renames a canvas through the ⋯ menu", async () => {
    const user = userEvent.setup();
    const rename = vi.fn().mockResolvedValue({ title: "Renamed" });
    useMutationMock.mockReturnValue(rename);
    backend(WORKSPACE, [canvas()]);
    renderWorkspace();

    await user.click(menuFor("Claim intake"));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = screen.getByLabelText("Canvas title");
    await user.clear(field);
    await user.type(field, "Renamed{Enter}");
    expect(rename).toHaveBeenCalledWith({ canvasId: "c1", title: "Renamed" });
  });

  /*
   * Hard delete, so the confirmation has to say so and has to arrive
   * already armed — choosing "Delete canvas…" was the first of the two
   * decisions, and repeating it under the menu that offered it is not a
   * second safeguard.
   */
  test("deletes a canvas behind an armed confirmation", async () => {
    const user = userEvent.setup();
    const remove = vi.fn().mockResolvedValue({ bytes_reclaimed: 2048 });
    useMutationMock.mockReturnValue(remove);
    backend(WORKSPACE, [canvas()]);
    renderWorkspace();

    await user.click(menuFor("Claim intake"));
    await user.click(screen.getByRole("menuitem", { name: "Delete canvas…" }));
    expect(screen.getByText(/Deletes “Claim intake” and every version of it/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete canvas" }));
    expect(remove).toHaveBeenCalledWith({ canvasId: "c1" });
    expect(await screen.findByText(/2 KB freed/)).toBeInTheDocument();
  });

  test("keeps the shell when the address names no workspace", () => {
    backend(null, undefined);
    renderWorkspace();
    expect(screen.getByText("No workspace at this address.")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeInTheDocument();
  });

  test("points an empty workspace at the way canvases arrive", () => {
    backend(WORKSPACE, []);
    renderWorkspace();
    expect(screen.getByText("No canvases here yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse assets" })).toHaveAttribute(
      "href",
      "/w/osago/assets",
    );
  });
});
