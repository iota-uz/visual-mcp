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
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
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
  state.query.mockImplementation((ref) =>
    getFunctionName(ref) === "videoReview:renderMetadata"
      ? {
          jobId: "job",
          projectId: "project",
          versionId: "saved-version",
          language: "uz",
          sha256: "a".repeat(64),
          width: 360,
          height: 640,
          durationMs: 2000,
          fps: { numerator: 30, denominator: 1 },
          partial: state.partial,
          stale: state.stale,
          approvable: !state.partial,
          approval: null,
        }
      : { revision: 0, body: { text: "Persisted feedback" } },
  );
  state.mutation.mockImplementation((ref) =>
    getFunctionName(ref) === "videoReview:approve" ? state.approve : state.save,
  );
});
function mount() {
  return render(
    <VideoReview
      jobId={"job" as Id<"videoJobs">}
      projectId={"project" as Id<"videoProjects">}
      onBlocked={() => {}}
    />,
  );
}
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
