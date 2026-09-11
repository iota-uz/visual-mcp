import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { jobAssets, VideoJobPage } from "./VideoJob";

const { query, action, mutation } = vi.hoisted(() => ({
  query: vi.fn(),
  action: vi.fn(),
  mutation: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: query,
  useAction: () => action,
  useMutation: () => mutation,
}));
const base = {
  jobId: "job",
  kind: "image",
  workspaceId: "workspace",
  projectId: null,
  versionId: null,
  state: "running",
  stage: "dispatched",
  stale: false,
  result: null,
  error: null,
};
function page() {
  return (
    <MemoryRouter initialEntries={["/jobs/job"]}>
      <Routes>
        <Route path="/jobs/:jobId" element={<VideoJobPage />} />
      </Routes>
    </MemoryRouter>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  query.mockReturnValue(base);
});
test("projectless receipt displays reactive status without dispatching generation", () => {
  const view = render(page());
  expect(screen.getByRole("heading", { name: "image job" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("dispatched");
  query.mockReturnValue({
    ...base,
    state: "failed",
    error: {
      code: "PROVIDER_NOT_CONFIGURED",
      message: "No paid request sent",
      recovery: { kind: "configure_service" },
    },
  });
  view.rerender(page());
  expect(screen.getByRole("alert")).toHaveTextContent("administrator");
  expect(action).not.toHaveBeenCalled();
  expect(mutation).not.toHaveBeenCalled();
});
test("saved video output resolves only its pinned revision on explicit request", async () => {
  query.mockReturnValue({
    ...base,
    state: "succeeded",
    kind: "media",
    result: {
      kind: "media",
      outputs: [{ name: "proxy", asset: { assetId: "asset", revisionId: "revision" } }],
    },
  });
  action.mockResolvedValue({
    url: "https://example.test/signed.mp4",
    mimeType: "video/mp4",
    sha256: "f".repeat(64),
  });
  render(page());
  expect(action).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Open saved output" }));
  expect(action).toHaveBeenCalledWith({
    workspaceId: "workspace",
    asset: { assetId: "asset", revisionId: "revision" },
  });
  expect(await screen.findByLabelText("proxy")).toHaveAttribute(
    "src",
    "https://example.test/signed.mp4",
  );
  expect(screen.getByText("A completed job is not human approval.")).toBeInTheDocument();
});
test("unknown paid outcome never exposes automatic retry; stored receipt can reconcile explicitly", async () => {
  query.mockReturnValue({
    ...base,
    state: "outcome_unknown",
    error: {
      code: "RESULT_UNKNOWN",
      message: "Stored bytes available",
      recovery: { kind: "reconcile" },
    },
  });
  action.mockResolvedValue({ state: "running" });
  render(page());
  expect(screen.getByText(/Keep this receipt/)).toBeInTheDocument();
  expect(action).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Recover already stored output" }));
  expect(action).toHaveBeenCalledWith({ jobId: "job" });
  expect(mutation).not.toHaveBeenCalled();
});
test("lost local output exposes one explicit server-keyed retry and never triggers it automatically", async () => {
  query.mockReturnValue({
    ...base,
    kind: "render",
    state: "failed",
    stage: "recovery_source_unavailable",
    error: {
      code: "RESULT_PERSISTENCE_FAILED",
      reasonCode: "STORED_OUTPUT_UNAVAILABLE",
      message: "Reserved output is unavailable",
      recovery: { kind: "regenerate", safeToRegenerate: true },
    },
  });

  render(page());

  expect(screen.getByRole("alert")).toHaveTextContent(
    "It can be submitted again with a new idempotency key.",
  );
  expect(screen.getByRole("alert")).toHaveTextContent("STORED_OUTPUT_UNAVAILABLE");
  expect(
    screen.queryByRole("button", { name: "Recover already stored output" }),
  ).not.toBeInTheDocument();
  const retry = screen.getByRole("button", { name: "Render again" });
  expect(action).not.toHaveBeenCalled();
  expect(mutation).not.toHaveBeenCalled();
  await userEvent.click(retry);
  expect(mutation).toHaveBeenCalledWith({ jobId: "job" });
});
test("unknown or untrusted regeneration advice never exposes Render again", () => {
  query.mockReturnValue({
    ...base,
    kind: "render",
    state: "outcome_unknown",
    error: {
      code: "OUTCOME_UNKNOWN",
      message: "The effect is unknown",
      recovery: { kind: "inspect_job", safeToRegenerate: false },
    },
  });
  render(page());
  expect(screen.queryByRole("button", { name: "Render again" })).not.toBeInTheDocument();
  expect(mutation).not.toHaveBeenCalled();
});
test("arbitrary execution output is not interpreted as media authority", () => {
  expect(
    jobAssets({ kind: "execute", outputs: [{ asset: { assetId: "a", revisionId: "r" } }] }),
  ).toEqual([]);
  expect(
    jobAssets({
      kind: "render",
      video: { assetId: "a", revisionId: "r" },
      poster: { assetId: "b", revisionId: "p" },
    }),
  ).toHaveLength(2);
});
