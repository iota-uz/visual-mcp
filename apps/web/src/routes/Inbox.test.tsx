import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { InboxPage } from "./Inbox";

const { useQueryMock } = vi.hoisted(() => ({ useQueryMock: vi.fn() }));

vi.mock("convex/react", () => ({
  useQuery: useQueryMock,
}));

beforeEach(() => {
  useQueryMock.mockReset();
});

test("lists comment and loop work with links into the right room", () => {
  useQueryMock.mockReturnValue({
    count: 2,
    items: [
      {
        kind: "comment",
        id: "c1",
        title: "Claims map",
        detail: "Swapped the CTA",
        href: "/c/canvas-1?comments=1",
        workspace: "OSAGO",
      },
      {
        kind: "loop",
        id: "l1",
        title: "Farq reel",
        detail: "RU needs review",
        href: "/v/project-1?production=1",
        workspace: "OSAGO",
      },
    ],
  });
  render(
    <MemoryRouter>
      <InboxPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: /Claims map/ })).toHaveAttribute(
    "href",
    "/c/canvas-1?comments=1",
  );
  expect(screen.getByRole("link", { name: /Farq reel/ })).toHaveAttribute(
    "href",
    "/v/project-1?production=1",
  );
});

test("empty inbox says nothing is waiting", () => {
  useQueryMock.mockReturnValue({ count: 0, items: [] });
  render(
    <MemoryRouter>
      <InboxPage />
    </MemoryRouter>,
  );
  expect(screen.getByText("Nothing waiting.")).toBeInTheDocument();
});
