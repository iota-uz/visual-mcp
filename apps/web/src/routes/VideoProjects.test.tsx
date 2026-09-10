import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { ToastProvider } from "../components/Toast";
import { VideoProjectsPage } from "./VideoProjects";

const { query, mutation, paginate } = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  paginate: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: query,
  useMutation: mutation,
  usePaginatedQuery: paginate,
}));

beforeEach(() => {
  query.mockImplementation((_ref: unknown, args: unknown) => {
    if (args && typeof args === "object" && "slug" in args)
      return { workspace_id: "ws1", slug: "osago", name: "OSAGO" };
    return undefined;
  });
  mutation.mockReturnValue(vi.fn());
  paginate.mockReturnValue({
    results: [
      {
        projectId: "p1",
        title: "Farq reel",
        topic: "OSAGO",
        updatedAt: Date.now(),
        languages: ["ru", "uz"],
      },
    ],
    status: "Exhausted",
    loadMore: vi.fn(),
  });
});

test("lists video projects as cards with a workspace collection switch", () => {
  render(
    <MemoryRouter initialEntries={["/w/osago/videos"]}>
      <ToastProvider>
        <Routes>
          <Route path="/w/:wsSlug/videos" element={<VideoProjectsPage />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "Farq reel" })).toHaveAttribute("href", "/v/p1");
  expect(screen.getByRole("navigation", { name: "Workspace collections" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "New video" })).toBeInTheDocument();
});
