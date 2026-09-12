import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { Script } from "../../../../../packages/video/src/contracts";
import { ShotStudio } from "./ShotStudio";

const previewAsset = vi.fn().mockResolvedValue({
  url: "https://example.test/image",
  mimeType: "image/png",
});
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
  useAction: () => previewAsset,
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
      narration: "Voice over",
      onScreenText: [],
      visual: { description: "Product on a table", shot: "close-up", motion: "static" },
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
  await userEvent.click(screen.getByRole("button", { name: "Plan first shot" }));
  const next = onChange.mock.calls[0]?.[0];
  expect(next).toBeDefined();
  if (!next) throw new Error("Expected the shot draft to change");
  expect(next.sceneOrder).toEqual(["scene"]);
  const key = next.scenesById.scene.shotOrder[0];
  expect(key).toMatch(/^shot-/);
  expect(next.scenesById.scene.shotsById[key].method).toBe("remotion");
});

test("empty scene shows a first-shot invitation without a scene brief dump", () => {
  render(
    <ShotStudio
      {...ids}
      document={document}
      revision="s1"
      onChange={vi.fn()}
      locked={false}
      unsaved={false}
      sceneId="scene"
    />,
  );
  expect(screen.queryByRole("region", { name: "Selected scene context" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Plan the first shot" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Scene")).not.toBeInTheDocument();
  expect(screen.queryByText("Voice over")).not.toBeInTheDocument();
});

test("board shows every shot before any editor opens", async () => {
  const planned = Script.parse({
    ...document,
    scenesById: {
      scene: {
        ...document.scenesById.scene,
        shotOrder: ["hero", "detail"],
        shotsById: {
          hero: {
            purpose: "Show the product",
            method: "remotion",
            subjectAction: "Product rotates",
            cameraMotion: "",
            constraints: [],
            startImage: { assetId: "asset", revisionId: "rev" },
          },
          detail: {
            purpose: "Logo lockup",
            method: "higgsfield",
            subjectAction: "Logo settles",
            cameraMotion: "push-in",
            constraints: [],
          },
        },
      },
    },
  });
  const { container } = render(
    <ShotStudio
      {...ids}
      document={planned}
      revision="s1"
      onChange={vi.fn()}
      locked={false}
      unsaved={false}
    />,
  );
  expect(screen.getByRole("button", { name: /Edit shot 1/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Edit shot 2/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Show the product/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Logo lockup/ })).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Shot purpose" })).not.toBeInTheDocument();
  expect(screen.getByText(/Static \(scene\)/)).toBeInTheDocument();
  await waitFor(() => expect(container.querySelector(".video-beat-frame img")).toBeTruthy());
});

test("offers production methods as a keyboard-accessible radio group", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  const planned = Script.parse({
    ...document,
    scenesById: {
      scene: {
        ...document.scenesById.scene,
        shotOrder: ["shot"],
        shotsById: {
          shot: {
            purpose: "Show the product",
            method: "remotion",
            subjectAction: "Product rotates",
            cameraMotion: "static",
            constraints: [],
          },
        },
      },
    },
  });
  render(
    <ShotStudio
      {...ids}
      document={planned}
      revision="s1"
      onChange={onChange}
      locked={false}
      unsaved={false}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Edit shot 1/ }));

  expect(screen.getByRole("radio", { name: /Remotion/ })).toBeChecked();
  expect(screen.getByRole("combobox", { name: "Camera" })).toHaveValue("static");
  await user.click(screen.getByRole("radio", { name: /AI motion/ }));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      scenesById: expect.objectContaining({
        scene: expect.objectContaining({
          shotsById: expect.objectContaining({
            shot: expect.objectContaining({ method: "higgsfield" }),
          }),
        }),
      }),
    }),
  );
});
