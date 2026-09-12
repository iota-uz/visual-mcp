import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AssetsPage } from "./Assets";

const {
  useActionMock,
  useMutationMock,
  useQueryMock,
  listAssetsMock,
  setTagsMock,
  moveAssetsMock,
} = vi.hoisted(() => ({
  useActionMock: vi.fn(),
  useMutationMock: vi.fn(),
  useQueryMock: vi.fn(),
  listAssetsMock: vi.fn(),
  setTagsMock: vi.fn(),
  moveAssetsMock: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: useActionMock,
  useMutation: useMutationMock,
  useQuery: useQueryMock,
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
    useQueryMock.mockReset();
    listAssetsMock.mockReset();
    setTagsMock.mockReset();
    moveAssetsMock.mockReset();
    useActionMock.mockReturnValue(listAssetsMock);
    useMutationMock.mockReturnValue(vi.fn());
    useQueryMock.mockReturnValue(undefined);
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

  test("selects visible assets, previews a destination and moves them as one batch", async () => {
    listAssetsMock.mockResolvedValue([
      {
        asset_id: "asset-1",
        asset_ref: "asset://workspace/osago/logo@1",
        scope: "workspace",
        workspace_slug: "osago",
        slug: "logo",
        name: "Logo",
        description: null,
        tags: [],
        kind: "svg",
        revision: 1,
        mime_type: "image/svg+xml",
        size_bytes: 10,
        content_hash: "one",
        original_filename: "logo.svg",
        updated_at: 1,
        preview_url: "/logo.svg",
      },
      {
        asset_id: "asset-2",
        asset_ref: "asset://workspace/osago/voice@1",
        scope: "workspace",
        workspace_slug: "osago",
        slug: "voice",
        name: "Voice",
        description: null,
        tags: [],
        kind: "audio",
        revision: 1,
        mime_type: "audio/mpeg",
        size_bytes: 20,
        content_hash: "two",
        original_filename: "voice.mp3",
        updated_at: 1,
        preview_url: "/voice.mp3",
      },
    ]);
    useQueryMock.mockImplementation((_fn, args) => {
      if (args === "skip") return undefined;
      if (args && "slug" in args) return { workspace_id: "osago-id", slug: "osago", name: "Osago" };
      if (args && "destinationWorkspaceSlug" in args)
        return { status: "ready", readyCount: 2, conflicts: [] };
      return [
        { workspace_id: "osago-id", slug: "osago", name: "Osago" },
        { workspace_id: "insurance-id", slug: "insurance", name: "Insurance" },
      ];
    });
    moveAssetsMock.mockResolvedValue({
      status: "moved",
      movedCount: 2,
      replayed: false,
      conflicts: [],
      items: [
        {
          previousAssetRef: "asset://workspace/osago/logo@1",
          assetRef: "asset://workspace/insurance/logo@1",
        },
        {
          previousAssetRef: "asset://workspace/osago/voice@1",
          assetRef: "asset://workspace/insurance/voice@1",
        },
      ],
    });
    useMutationMock.mockReturnValue(moveAssetsMock);
    const user = userEvent.setup();
    renderAssets();

    await user.click(await screen.findByRole("button", { name: "Select" }));
    await user.click(screen.getByRole("checkbox", { name: "Select all visible" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Move" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Destination workspace" }),
      "insurance",
    );
    await user.click(screen.getByRole("button", { name: "Move 2 assets" }));

    expect(moveAssetsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceWorkspaceSlug: "osago",
        destinationWorkspaceSlug: "insurance",
        assetRefs: ["asset://workspace/osago/logo@1", "asset://workspace/osago/voice@1"],
        idempotencyKey: expect.any(String),
      }),
    );
    expect(screen.queryByText("Logo")).not.toBeInTheDocument();
    expect(screen.queryByText("Voice")).not.toBeInTheDocument();
  });
});
