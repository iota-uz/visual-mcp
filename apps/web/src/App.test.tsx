import { render, screen } from "@testing-library/react";
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
    useQueryMock.mockReturnValue([
      {
        workspace_id: "workspace-1",
        slug: "insurance",
        name: "Insurance",
      },
    ]);
  });

  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Sidebar />
      </MemoryRouter>,
    );
  }

  test("links workspace asset shortcuts to the explicit asset route", () => {
    renderAt("/");

    expect(screen.getByRole("link", { name: "Insurance" })).toHaveAttribute(
      "href",
      "/w/insurance/assets",
    );
  });

  /*
   * The shortcuts are workspace asset libraries, not a second workspace list, and
   * the group heading is the only thing that says so. It must not become
   * part of each link's name — "Insurance" is what that link is called.
   */
  test("labels the shortcut list without renaming the links in it", () => {
    renderAt("/");

    const list = screen.getByRole("list", { name: "Workspace asset libraries" });
    expect(list).toContainElement(screen.getByRole("link", { name: "Insurance" }));
  });

  /* /w/:slug is the canvas gallery, while /w/:slug/assets is that workspace's
   * own library. Shared assets must not also light up for the latter. */
  test.each([
    ["/", "Workspaces"],
    ["/w/insurance", "Workspaces"],
    ["/assets", "Shared assets"],
    ["/w/insurance/assets", "Insurance"],
    ["/videos", "Videos"],
    ["/w/insurance/videos", "Videos"],
    ["/v/project-1", "Videos"],
  ])("marks the rail item that owns %s", (path, active) => {
    renderAt(path);
    expect(screen.getByRole("link", { name: active })).toHaveClass("active");
  });

  test("does not mark shared assets active inside a workspace library", () => {
    renderAt("/w/insurance/assets");

    expect(screen.getByRole("link", { name: "Insurance" })).toHaveClass("active");
    expect(screen.getByRole("link", { name: "Shared assets" })).not.toHaveClass("active");
  });
});
