import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { HomePage } from "./Home";

const { useQueryMock, useMutationMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
  useMutationMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
  useMutation: useMutationMock,
}));

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

describe("HomePage", () => {
  beforeEach(() => {
    useQueryMock.mockReset();
    useMutationMock.mockReset();
    useMutationMock.mockReturnValue(vi.fn());
  });

  test("shows an empty-state message when there are no workspaces", () => {
    useQueryMock.mockImplementation((_ref: unknown, args: unknown) => {
      if (args && typeof args === "object" && "query" in args) return [];
      return [];
    });
    renderHome();
    expect(screen.getByText("No workspaces yet.")).toBeInTheDocument();
  });

  test("renders a link per workspace, using its slug", () => {
    useQueryMock.mockImplementation((_ref: unknown, args: unknown) => {
      if (args && typeof args === "object" && "query" in args) return [];
      return [{ workspace_id: "ws1", slug: "osago", name: "OSAGO", description: undefined }];
    });
    renderHome();
    const link = screen.getByRole("link", { name: /OSAGO/ });
    expect(link).toHaveAttribute("href", "/w/osago");
  });

  test("node search box queries canvasNodes as the user types and links results by node id", async () => {
    useQueryMock.mockImplementation((_ref: unknown, args: unknown) => {
      if (args && typeof args === "object" && "query" in args) {
        const q = (args as { query: string }).query;
        if (q === "europrotocol") {
          return [
            {
              canvasId: "c1",
              canvasTitle: "Fast Settlement",
              workspaceId: "ws1",
              nodeId: "checkout",
              nodeTitle: "Checkout",
              nodeEyebrow: "Payments",
            },
          ];
        }
        return [];
      }
      return [];
    });
    renderHome();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("Search canvas nodes…"), "europrotocol");

    const link = await screen.findByRole("link", { name: /Checkout/ });
    expect(link).toHaveAttribute("href", "/c/c1?node=checkout");
    expect(screen.getByText(/Payments/)).toBeInTheDocument();
  });

  test("empty state explains how to connect an agent, for both Claude Code and Codex", () => {
    useQueryMock.mockReturnValue([]);
    renderHome();

    expect(screen.getByRole("link", { name: /mint an MCP token/ })).toHaveAttribute(
      "href",
      "/settings/tokens",
    );
    expect(screen.getByText(/claude mcp add --transport http visual-canvas/)).toBeInTheDocument();
    expect(screen.getByText(/codex mcp add visual-canvas --url/)).toBeInTheDocument();
    // Nothing to look at yet, so the instructions start open.
    expect(screen.getByText("Connect an agent").closest("details")).toHaveAttribute("open");
  });

  // Regression: the panel used to be gated on `workspaces.length === 0`, so
  // the moment you connected an agent successfully the instructions vanished
  // and there was no path back to them from anywhere in the app.
  test("connect instructions stay reachable once workspaces exist", () => {
    useQueryMock.mockImplementation((_ref: unknown, args: unknown) => {
      if (args && typeof args === "object" && "query" in args) return [];
      if (args && typeof args === "object" && "workspaceId" in args) return [];
      return [{ workspace_id: "ws1", slug: "osago", name: "OSAGO", description: undefined }];
    });
    renderHome();

    const disclosure = screen.getByText("Connect an agent").closest("details");
    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByText(/claude mcp add --transport http visual-canvas/)).toBeInTheDocument();
    expect(screen.getByText(/codex mcp add visual-canvas --url/)).toBeInTheDocument();
  });

  // The curator surface deletes hard (the workspace and every canvas in it),
  // so the confirmation is the only thing between a stray click and data
  // loss — and it must not be a browser modal.
  describe("workspace deletion", () => {
    function mockOneWorkspaceWithTwoCanvases() {
      useQueryMock.mockImplementation((_ref: unknown, args: unknown) => {
        if (args && typeof args === "object") {
          if ("query" in args) return [];
          if ("workspaceId" in args) return [{ canvas_id: "c1" }, { canvas_id: "c2" }];
        }
        return [{ workspace_id: "ws1", slug: "osago", name: "OSAGO", description: undefined }];
      });
    }

    test("requires an explicit second click and names what will be lost", async () => {
      const mutation = vi.fn().mockResolvedValue({ bytes_reclaimed: 0, canvases_deleted: 2 });
      useMutationMock.mockReturnValue(mutation);
      mockOneWorkspaceWithTwoCanvases();
      renderHome();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Delete/ }));
      expect(mutation).not.toHaveBeenCalled();
      expect(screen.getByText(/Deletes this workspace and 2 canvases/)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Really delete?" }));
      expect(mutation).toHaveBeenCalledWith({ workspaceId: "ws1" });
    });

    test("cancelling disarms the confirmation without deleting", async () => {
      const mutation = vi.fn();
      useMutationMock.mockReturnValue(mutation);
      mockOneWorkspaceWithTwoCanvases();
      renderHome();

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /Delete/ }));
      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mutation).not.toHaveBeenCalled();
      expect(screen.queryByText("Really delete?")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Delete/ })).toBeInTheDocument();
    });
  });

  test("renaming a workspace happens inline and submits the trimmed name", async () => {
    const mutation = vi.fn().mockResolvedValue({ name: "OSAGO v2" });
    useMutationMock.mockReturnValue(mutation);
    useQueryMock.mockImplementation((_ref: unknown, args: unknown) => {
      if (args && typeof args === "object" && "query" in args) return [];
      if (args && typeof args === "object" && "workspaceId" in args) return [];
      return [{ workspace_id: "ws1", slug: "osago", name: "OSAGO", description: undefined }];
    });
    renderHome();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Rename/ }));

    const input = screen.getByLabelText("Workspace name");
    await user.clear(input);
    await user.type(input, "  OSAGO v2  ");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(mutation).toHaveBeenCalledWith({ workspaceId: "ws1", name: "OSAGO v2" });
  });
});
