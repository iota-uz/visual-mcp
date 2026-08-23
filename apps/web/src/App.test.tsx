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

  test("links workspace asset shortcuts to the explicit asset route", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Insurance" })).toHaveAttribute(
      "href",
      "/w/insurance/assets",
    );
  });
});
