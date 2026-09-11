import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, expect, test, vi } from "vitest";
import { VideoJobs } from "./VideoJobs";

const { query, cancel, regenerate } = vi.hoisted(() => ({
  query: vi.fn(),
  cancel: vi.fn(),
  regenerate: vi.fn().mockResolvedValue({ jobId: "attempt-3" }),
}));
vi.mock("convex/react", () => ({
  useQuery: query,
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "videoJobs:regenerate" ? regenerate : cancel,
}));

const attempt = (overrides: Record<string, unknown>) => ({
  jobId: "attempt-2",
  operationId: "operation",
  attemptNumber: 2,
  retryOfJobId: "attempt-1",
  kind: "render",
  versionId: "version",
  state: "failed",
  stage: "recovery_source_unavailable",
  updatedAt: 2,
  error: {
    code: "RESULT_PERSISTENCE_FAILED",
    message: "Stored output unavailable",
    recovery: { kind: "regenerate", safeToRegenerate: true },
  },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  query.mockImplementation((ref) =>
    getFunctionName(ref) === "videoJobs:listOperations"
      ? [
          {
            operationId: "operation",
            kind: "render",
            retryCount: 1,
            latestAttempt: attempt({}),
            latestSuccessfulAttempt: attempt({
              jobId: "attempt-1",
              attemptNumber: 1,
              retryOfJobId: null,
              state: "succeeded",
              stage: "persisted",
              updatedAt: 1,
              error: null,
            }),
            attempts: [
              attempt({}),
              attempt({
                jobId: "attempt-1",
                attemptNumber: 1,
                retryOfJobId: null,
                state: "succeeded",
                stage: "persisted",
                updatedAt: 1,
                error: null,
              }),
            ],
          },
        ]
      : { version: { language: "ru" }, label: "Pinned draft" },
  );
});

test("failed retry stays grouped under the highlighted successful draft", async () => {
  const open = vi.fn();
  render(
    <VideoJobs
      workspaceId={"workspace" as never}
      projectId={"project" as never}
      onOpenRender={open}
    />,
  );
  await userEvent.click(screen.getByText("Video export"));
  expect(screen.getByRole("region", { name: "Latest successful draft" })).toHaveTextContent(
    "Pinned draft",
  );
  expect(screen.getByText("Attempt 2")).toBeInTheDocument();
  expect(screen.getByText("Attempt 1")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Review export" }));
  expect(open).toHaveBeenCalledWith("attempt-1");
  await userEvent.click(screen.getByRole("button", { name: "Render again" }));
  expect(regenerate).toHaveBeenCalledWith({ jobId: "attempt-2" });
});

test("unknown latest attempt has history but no retry control", async () => {
  query.mockImplementation((ref) =>
    getFunctionName(ref) === "videoJobs:listOperations"
      ? [
          {
            operationId: "operation",
            kind: "render",
            retryCount: 0,
            latestAttempt: attempt({
              state: "outcome_unknown",
              error: {
                code: "OUTCOME_UNKNOWN",
                message: "Unknown",
                recovery: { kind: "inspect_job", safeToRegenerate: false },
              },
            }),
            latestSuccessfulAttempt: null,
            attempts: [
              attempt({
                state: "outcome_unknown",
                error: {
                  code: "OUTCOME_UNKNOWN",
                  message: "Unknown",
                  recovery: { kind: "inspect_job", safeToRegenerate: false },
                },
              }),
            ],
          },
        ]
      : null,
  );
  render(<VideoJobs workspaceId={"workspace" as never} projectId={"project" as never} />);
  await userEvent.click(screen.getByText("Video export"));
  expect(screen.queryByRole("button", { name: "Render again" })).not.toBeInTheDocument();
  expect(regenerate).not.toHaveBeenCalled();
});
