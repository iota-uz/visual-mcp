import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AssetsPage } from "./Assets";

const { useActionMock, useMutationMock, listAssetsMock, setTagsMock } = vi.hoisted(() => ({
  useActionMock: vi.fn(),
  useMutationMock: vi.fn(),
  listAssetsMock: vi.fn(),
  setTagsMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: useActionMock,
  useMutation: useMutationMock,
  useQuery: () => undefined,
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
    setTagsMock.mockReset();
    useActionMock.mockReturnValue(listAssetsMock);
    useMutationMock.mockReturnValue(vi.fn());
  });

  test("is an asset-only surface with shared video-pipeline audio assets", async () => {
    listAssetsMock.mockResolvedValue([]);
    renderAssets();

    expect(await screen.findByText("No assets here yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Canvases" })).toHaveAttribute("href", "/w/osago");
    expect(screen.getByRole("link", { name: "Videos" })).toHaveAttribute("href", "/w/osago/videos");
    expect(screen.getByRole("button", { name: "audio" })).toBeInTheDocument();
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

  test("adds and removes tags on an existing asset", async () => {
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
    setTagsMock.mockResolvedValue({
      assetRef: "asset://workspace/osago/logo@1",
      revision: 1,
      tags: ["launch"],
    });
    useMutationMock.mockReturnValue(setTagsMock);
    const user = userEvent.setup();
    renderAssets();

    await user.click(await screen.findByRole("button", { name: "Edit tags for Iota logo" }));
    expect(screen.getByRole("dialog", { name: "Edit tags" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove brand tag" }));
    await user.type(screen.getByLabelText("Tags"), "Launch{Enter}");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(setTagsMock).toHaveBeenCalledWith({
      assetRef: "asset://workspace/osago/logo@1",
      tags: ["launch"],
    });
    expect(screen.queryByRole("dialog", { name: "Edit tags" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "launch" })).toBeInTheDocument();
  });
});
