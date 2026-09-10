import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import type { Id } from "../../../../convex/_generated/dataModel";
import { SharedImageStudio } from "./SharedImageStudio";

const { submit } = vi.hoisted(() => ({ submit: vi.fn() }));
vi.mock("convex/react", () => ({
  useQuery: () => ({ userId: "user" }),
  useMutation: () => submit,
  useAction: () => vi.fn(),
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
}));
beforeEach(() => {
  submit.mockReset();
  localStorage.clear();
});
test("image generation is explicitly paid and lost submission retries identical key and input", async () => {
  submit
    .mockRejectedValueOnce(new Error("transport unknown"))
    .mockResolvedValueOnce({ jobId: "job" });
  const view = render(<SharedImageStudio workspaceId={"workspace" as Id<"workspaces">} />);
  const button = screen.getByRole("button", { name: "Generate candidate" });
  expect(button).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Image direction"), "Exact product silhouette");
  expect(button).toBeDisabled();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(button);
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("Image direction")).toBeDisabled();
  view.unmount();
  render(<SharedImageStudio workspaceId={"workspace" as Id<"workspaces">} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Retry the same submission" })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Retry the same submission" }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  expect(submit.mock.calls[1]).toEqual(submit.mock.calls[0]);
  expect(submit.mock.calls[0]?.[0].request).toMatchObject({
    model: "gpt-image-2.5-sunburst",
    allowPaid: true,
    size: "1152x2048",
  });
});
