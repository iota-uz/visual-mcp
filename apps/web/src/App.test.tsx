import { render, screen } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { Sidebar } from "./App";

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
}));

vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useQuery: useQueryMock,
}));

vi.mock("./auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth")>()),
  useSessionUser: () => ({ email: "agent@iota.uz" }),
  useSignOut: () => vi.fn(),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    useQueryMock.mockImplementation((ref) => {
      if (getFunctionName(ref) === "inbox:needsYou") return { count: 0, items: [] };
      return [
        {
          workspace_id: "workspace-1",
          slug: "insurance",
          name: "Insurance",
        },
      ];
    });
  });

  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Sidebar />
      </MemoryRouter>,
    );
  }

  test("links workspace names to the workspace, not its asset library", () => {
    renderAt("/");

    expect(screen.getByRole("link", { name: "Insurance" })).toHaveAttribute("href", "/w/insurance");
  });

  test("labels the workspace list without renaming the links in it", () => {
    renderAt("/");

    const list = screen.getByRole("list", { name: "Workspace list" });
    expect(list).toContainElement(screen.getByRole("link", { name: "Insurance" }));
  });

  test.each([
    ["/", "Workspaces"],
    ["/w/insurance", "Insurance"],
    ["/assets", "Shared assets"],
    ["/w/insurance/assets", "Insurance"],
    ["/videos", "Videos"],
    ["/w/insurance/videos", "Insurance"],
    ["/v/project-1", "Videos"],
  ])("marks the rail item that owns %s", (path, active) => {
    renderAt(path);
    expect(screen.getByRole("link", { name: active })).toHaveClass("active");
  });

  test("shows Needs you when the inbox has work", () => {
    useQueryMock.mockImplementation((ref) => {
      if (getFunctionName(ref) === "inbox:needsYou") {
        return { count: 2, items: [] };
      }
      return [{ workspace_id: "workspace-1", slug: "insurance", name: "Insurance" }];
    });
    renderAt("/");
    expect(screen.getByRole("link", { name: "Needs you, 2 waiting" })).toHaveAttribute(
      "href",
      "/inbox",
    );
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  test("does not mark shared assets active inside a workspace library", () => {
    renderAt("/w/insurance/assets");

    expect(screen.getByRole("link", { name: "Insurance" })).toHaveClass("active");
    expect(screen.getByRole("link", { name: "Shared assets" })).not.toHaveClass("active");
  });
});
