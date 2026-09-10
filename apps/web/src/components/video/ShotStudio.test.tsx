import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Script } from "../../../../../packages/video/src/contracts";
import { ShotStudio } from "./ShotStudio";

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
  useAction: () => vi.fn().mockResolvedValue({ url: "https://example.test/image" }),
  usePaginatedQuery: () => ({ results: [], status: "Exhausted", loadMore: vi.fn() }),
}));
const document = Script.parse({
  language: "ru",
  writingSystem: "cyrillic",
  title: "Test",
  premise: "",
  sceneOrder: ["scene"],
  scenesById: {
    scene: {
      purpose: "Scene",
      narration: "",
      onScreenText: [],
      visual: { description: "", shot: "", motion: "" },
      shotOrder: [],
      shotsById: {},
      claims: [],
    },
  },
});
const ids = {
  workspaceId: "workspace" as Id<"workspaces">,
  projectId: "project" as Id<"videoProjects">,
  draftId: "draft" as Id<"videoDrafts">,
};
test("adding shot preserves stable scene identity and defaults to deterministic media", async () => {
  const onChange = vi.fn();
  render(
    <ShotStudio
      {...ids}
      document={document}
      revision="s1"
      onChange={onChange}
      locked={false}
      unsaved={false}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Add shot" }));
  const next = onChange.mock.calls[0]![0];
  expect(next.sceneOrder).toEqual(["scene"]);
  const key = next.scenesById.scene.shotOrder[0];
  expect(key).toMatch(/^shot-/);
  expect(next.scenesById.scene.shotsById[key].method).toBe("remotion");
});
