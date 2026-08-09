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
    expect(screen.getByText("No workspaces yet — create one below.")).toBeInTheDocument();
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
});
