import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { HumanLoopPanel } from "./HumanLoopPanel";

const mocks = vi.hoisted(() => ({
  mutation: vi.fn(),
  state: "paused",
  iteration: 2,
  pending: ["proposal"],
}));
vi.mock("convex/react", () => ({
  useQuery: () => ({
    loopId: "loop",
    revisionId: "r1",
    projectId: "project",
    language: "ru",
    state: mocks.state,
    iteration: mocks.iteration,
    iterationLimit: 3,
    noProgress: 0,
    noProgressLimit: 2,
    baseline: "baseline",
    selectedCandidate: "candidate",
    pendingProposalIds: mocks.pending,
    stopReason: "Human feedback changed context",
  }),
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => (args: unknown) =>
    mocks.mutation(getFunctionName(ref), args),
}));
beforeEach(() => {
  mocks.mutation.mockReset().mockResolvedValue({});
  mocks.iteration = 2;
  mocks.pending = ["proposal"];
});
test("human archive is explicit, preserves original CAS, and does not resume or approve", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<HumanLoopPanel projectId={"project" as Id<"videoProjects">} language="ru" />);
  expect(screen.getByRole("button", { name: "Resume existing experiment" })).toBeDisabled();
  await userEvent.type(
    screen.getByLabelText("Reason for human pause or replanning"),
    "New direction after review",
  );
  await userEvent.click(screen.getByRole("button", { name: "Archive pending proposal" }));
  await waitFor(() => expect(mocks.mutation).toHaveBeenCalledOnce());
  expect(mocks.mutation.mock.calls[0]).toEqual([
    "videoWorkflow:abandonPending",
    {
      loopId: "loop",
      expectedLoopRevision: "r1",
      idempotencyKey: expect.any(String),
      reason: "New direction after review",
    },
  ]);
  expect(screen.getByText(/Rounds 2 \/ 3/)).toBeInTheDocument();
});
test("exhausted limits cannot be reset by resume", () => {
  mocks.iteration = 3;
  mocks.pending = [];
  render(<HumanLoopPanel projectId={"project" as Id<"videoProjects">} language="ru" />);
  expect(screen.getByRole("button", { name: "Resume existing experiment" })).toBeDisabled();
  expect(screen.getByText(/separately defined experiment/)).toBeInTheDocument();
  expect(mocks.mutation).not.toHaveBeenCalled();
});
