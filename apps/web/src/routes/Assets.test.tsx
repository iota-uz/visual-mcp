import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AssetsPage } from "./Assets";

const { useActionMock, useMutationMock, listAssetsMock } = vi.hoisted(() => ({
  useActionMock: vi.fn(),
  useMutationMock: vi.fn(),
  listAssetsMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: useActionMock,
  useMutation: useMutationMock,
}));

function renderAssets() {
  return render(
    <MemoryRouter initialEntries={["/w/osago"]}>
      <Routes>
        <Route path="/w/:wsSlug" element={<AssetsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AssetsPage", () => {
  beforeEach(() => {
    useActionMock.mockReset();
    useMutationMock.mockReset();
    listAssetsMock.mockReset();
    useActionMock.mockReturnValue(listAssetsMock);
    useMutationMock.mockReturnValue(vi.fn());
  });

  test("is an asset-only surface with no canvas tab or audio filter", async () => {
    listAssetsMock.mockResolvedValue([]);
    renderAssets();

    expect(await screen.findByText("No assets here yet.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Canvases" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "audio" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "all" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/Reusable media for/)).toHaveTextContent("Reusable media for osago.");
    expect(screen.getByRole("link", { name: "Workspaces" })).toHaveAttribute("href", "/");
  });

  test("opens and closes a fullscreen preview from an asset card", async () => {
    listAssetsMock.mockResolvedValue([
      {
        asset_id: "asset-1",
        asset_ref: "asset://workspace/osago/logo@1",
        scope: "workspace",
        workspace_slug: "osago",
        slug: "logo",
        name: "Iota logo",
        description: null,
        tags: ["brand"],
        kind: "svg",
        revision: 1,
        mime_type: "image/svg+xml",
        size_bytes: 2048,
        content_hash: "sha256",
        original_filename: "logo.svg",
        updated_at: 1,
        preview_url: "/logo.svg",
      },
    ]);
    const user = userEvent.setup();
    renderAssets();

    expect(await screen.findByAltText("Preview of Iota logo")).toHaveAttribute("src", "/logo.svg");
    expect(screen.getByText("SVG")).toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Open preview of Iota logo" });
    await user.click(trigger);

    expect(screen.getByRole("dialog")).toHaveAccessibleName("Iota logo");
    expect(screen.getAllByAltText("Preview of Iota logo")).toHaveLength(2);
    expect(screen.getByText("logo.svg · image/svg+xml · 2 KB")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close preview of Iota logo" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
