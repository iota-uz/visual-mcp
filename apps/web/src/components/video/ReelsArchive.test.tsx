import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { ReelsArchive } from "./ReelsArchive";

const mocks = vi.hoisted(() => ({ preview: vi.fn(), loadMore: vi.fn(), archive: true }));
vi.mock("convex/react", () => ({
  useQuery: () =>
    mocks.archive
      ? {
          _id: "migration",
          workspaceId: "workspace",
          archiveAsset: { assetId: "archive", revisionId: "archive-rev" },
          sourceBackupSha256: "backup-sha",
          archiveSha256: "archive-sha",
          warning: "Imported approximation",
          nativeVersions: [
            {
              language: "ru",
              sourceVersionId: "original-ru",
              versionId: "native-ru",
              manifestSha256: "native-sha",
            },
          ],
          assetMap: [
            {
              sha256: "original-mp4-sha",
              mimeType: "video/mp4",
              asset: { assetId: "video", revisionId: "original-rev" },
            },
          ],
        }
      : null,
  useAction: () => mocks.preview,
  usePaginatedQuery: (
    _ref: unknown,
    args: { kind: string },
    options: { initialNumItems: number },
  ) => {
    expect(options.initialNumItems).toBe(3);
    return {
      results:
        args.kind === "version"
          ? [
              {
                _id: "row",
                kind: "version",
                sourceId: "original-ru",
                data: JSON.stringify({
                  id: "original-ru",
                  hash: "original-version-sha",
                  language: "ru",
                  manifest: { review: { kind: "exact", videoHash: "original-mp4-sha" } },
                }),
              },
            ]
          : [],
      status: "CanLoadMore",
      loadMore: mocks.loadMore,
    };
  },
}));
beforeEach(() => {
  mocks.archive = true;
  mocks.preview.mockReset().mockResolvedValue({ url: "https://example.test/signed-original" });
  mocks.loadMore.mockReset();
});
test("archive preserves original/new hash distinction and only loads historical media on explicit request", async () => {
  render(
    <MemoryRouter>
      <ReelsArchive projectId={"project" as Id<"videoProjects">} />
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByText("Imported project provenance"));
  expect(
    screen.getByText("They are not current approvals, active jobs or trusted quality evidence."),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByText("Open expert archive tools"));
  expect(screen.getByText("native-sha")).toBeInTheDocument();
  expect(screen.getByText("original-version-sha")).toBeInTheDocument();
  expect(mocks.preview).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Preview original MP4" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Original Reels MP4")).toHaveAttribute(
      "src",
      "https://example.test/signed-original",
    ),
  );
  expect(mocks.preview).toHaveBeenCalledWith({
    workspaceId: "workspace",
    asset: { assetId: "video", revisionId: "original-rev" },
  });
  await userEvent.click(screen.getByRole("button", { name: "Load three more original records" }));
  expect(mocks.loadMore).toHaveBeenCalledWith(3);
});
test("non-imported projects show no archive controls", () => {
  mocks.archive = false;
  render(
    <MemoryRouter>
      <ReelsArchive projectId={"project" as Id<"videoProjects">} />
    </MemoryRouter>,
  );
  expect(screen.queryByText("Imported project provenance")).not.toBeInTheDocument();
});
