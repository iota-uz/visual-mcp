import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { VideoReview } from "./VideoReview";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  preview: vi.fn(),
  approve: vi.fn(),
  save: vi.fn(),
  partial: false,
  stale: false,
}));
vi.mock("convex/react", () => ({
  useQuery: state.query,
  useMutation: state.mutation,
  useAction: () => state.preview,
  usePaginatedQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "videoJobs:listJobs"
      ? {
          results: [
            { jobId: "job", state: "succeeded" },
            { jobId: "older", state: "succeeded" },
          ],
          status: "Exhausted",
          loadMore: vi.fn(),
        }
      : { results: [], status: "Exhausted", loadMore: vi.fn() },
}));
beforeEach(() => {
  state.partial = false;
  state.stale = false;
  state.approve.mockReset().mockResolvedValue({ approvalId: "approval" });
  state.preview.mockReset().mockResolvedValue({
    videoUrl: "https://example.test/video",
    captionsUrl: "https://example.test/captions",
    posterUrl: "https://example.test/poster",
    expiresAt: 900000,
  });
  state.save.mockReset().mockResolvedValue({ revision: 1 });
  state.query.mockImplementation((ref, args: { jobId?: string; versionId?: string }) => {
    if (getFunctionName(ref) === "video:getVersion")
      return { label: args.versionId === "older-version" ? "Earlier cut" : "Launch cut" };
    if (getFunctionName(ref) === "videoReview:renderMetadata") {
      const older = args.jobId === "older";
      return {
        jobId: older ? "older" : "job",
        projectId: "project",
        versionId: older ? "older-version" : "saved-version",
        language: older ? "ru" : "uz",
        sha256: (older ? "b" : "a").repeat(64),
        width: 360,
        height: 640,
        durationMs: 2000,
        videoDurationMs: 2000,
        containerDurationMs: 2000,
        frameCount: 60,
        fps: { numerator: 30, denominator: 1 },
        partial: state.partial,
        stale: older || state.stale,
        approvable: !state.partial,
        approval: null,
      };
    }
    return { revision: 0, body: { text: "Persisted feedback" } };
  });
  state.mutation.mockImplementation((ref) =>
    getFunctionName(ref) === "videoReview:approve" ? state.approve : state.save,
  );
});
function mount(onOpenRender = vi.fn()) {
  return render(
    <VideoReview
      jobId={"job" as Id<"videoJobs">}
      projectId={"project" as Id<"videoProjects">}
      workspaceId={"workspace" as Id<"workspaces">}
      onOpenRender={onOpenRender}
      onBlocked={() => {}}
    />,
  );
}
test("successful current and older exports are navigable without implying approval", async () => {
  const onOpenRender = vi.fn();
  mount(onOpenRender);
  expect(await screen.findByText("Launch cut")).toBeInTheDocument();
  expect(screen.getByText("Current draft · Not approved")).toBeInTheDocument();
  expect(screen.getByText("Older draft · Not approved")).toBeInTheDocument();
  expect(screen.getByText("Opening an export does not approve it.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Earlier cut/ }));
  expect(onOpenRender).toHaveBeenCalledWith("older");
  expect(state.approve).not.toHaveBeenCalled();
});
test("human confirmation requires loaded media, resets on failure, and binds exact Uzbek historical candidate", async () => {
  state.stale = true;
  mount();
  const approval = await screen.findByRole("button", { name: "Approve this exact MP4" });
  expect(approval).toBeDisabled();
  const video = await screen.findByLabelText("Video preview");
  fireEvent.loadedData(video);
  const checkbox = screen.getByRole("checkbox", { name: /I reviewed this older UZ candidate/ });
  await userEvent.click(checkbox);
  expect(approval).toBeEnabled();
  fireEvent.error(video);
  expect(approval).toBeDisabled();
  expect(checkbox).not.toBeChecked();
  fireEvent.loadedData(video);
  await userEvent.click(checkbox);
  await userEvent.click(approval);
  await waitFor(() =>
    expect(state.approve).toHaveBeenCalledWith(
      expect.objectContaining({
        versionId: "saved-version",
        language: "uz",
        sha256: "a".repeat(64),
        confirmedViewed: true,
      }),
    ),
  );
  expect(screen.getByText(/never to the newer draft/)).toBeInTheDocument();
});
test("partial preview stays unapprovable after load and saved feedback remains visible", async () => {
  state.partial = true;
  mount();
  fireEvent.loadedData(await screen.findByLabelText("Video preview"));
  expect(screen.getByRole("button", { name: "Approve this exact MP4" })).toBeDisabled();
  expect(screen.getByLabelText("Your feedback")).toHaveValue("Persisted feedback");
  expect(state.approve).not.toHaveBeenCalled();
});
