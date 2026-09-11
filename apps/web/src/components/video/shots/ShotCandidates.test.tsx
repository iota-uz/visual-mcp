import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { Script } from "../../../../../../packages/video/src/contracts";
import { ShotCandidates } from "./ShotCandidates";

const state = vi.hoisted(() => ({ status: "Exhausted", results: [] as unknown[] }));
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
  useAction: () => vi.fn().mockResolvedValue({ url: "https://example.test/candidate.mp4" }),
  usePaginatedQuery: () => ({
    results: state.results,
    status: state.status,
    loadMore: vi.fn(),
  }),
}));

const ids = {
  workspaceId: "workspace" as Id<"workspaces">,
  projectId: "project" as Id<"videoProjects">,
  draftId: "draft" as Id<"videoDrafts">,
};

function documentWithShot(overrides = {}) {
  return Script.parse({
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
        shotOrder: ["shot"],
        shotsById: {
          shot: {
            purpose: "Show the product",
            method: "higgsfield",
            subjectAction: "",
            cameraMotion: "static",
            constraints: [],
            ...overrides,
          },
        },
        claims: [],
      },
    },
  });
}

function shotOf(document: ReturnType<typeof documentWithShot>) {
  const scene = document.scenesById.scene;
  if (!scene) throw new Error("Expected the scene fixture");
  const shot = scene.shotsById.shot;
  if (!shot) throw new Error("Expected the shot fixture");
  return shot;
}

function mount(shot: ReturnType<typeof shotOf>) {
  return render(
    <ShotCandidates
      {...ids}
      sceneId="scene"
      shotId="shot"
      revision="s1"
      shot={shot}
      disabled={false}
      onSelect={vi.fn()}
    />,
  );
}

beforeEach(() => {
  state.status = "Exhausted";
  state.results = [];
});

test("empty candidates explain prerequisites and hide the compare control", () => {
  mount(shotOf(documentWithShot()));
  expect(
    screen.getByText("Pin a start image and describe the subject action to enable generation."),
  ).toBeInTheDocument();
  expect(screen.getByText(/No candidates yet for this shot/)).toBeInTheDocument();
  expect(screen.queryByLabelText("Compare candidates at time (seconds)")).not.toBeInTheDocument();
});

test("ready shots hide the prerequisite hint", () => {
  mount(
    shotOf(
      documentWithShot({
        subjectAction: "Product rotates",
        startImage: { assetId: "asset", revisionId: "rev" },
      }),
    ),
  );
  expect(
    screen.queryByText("Pin a start image and describe the subject action to enable generation."),
  ).not.toBeInTheDocument();
});

test("loading candidates show status instead of the empty hint", () => {
  state.status = "LoadingFirstPage";
  mount(shotOf(documentWithShot()));
  expect(screen.getByText("Loading shot candidates…")).toBeInTheDocument();
  expect(screen.queryByText(/No candidates yet for this shot/)).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Compare candidates at time (seconds)")).not.toBeInTheDocument();
});

test("listed candidates reveal the compare control", async () => {
  state.results = [
    {
      jobId: "job",
      state: "succeeded",
      error: null,
      context: { draftId: "draft", sceneId: "scene", shotId: "shot", scriptRevision: "s1" },
      result: {
        kind: "shot",
        artifacts: [{ mimeType: "video/mp4", asset: { assetId: "asset", revisionId: "rev" } }],
      },
    },
  ];
  mount(shotOf(documentWithShot()));
  expect(await screen.findByText("succeeded · Current shot plan")).toBeInTheDocument();
  expect(screen.getByLabelText("Compare candidates at time (seconds)")).toBeInTheDocument();
});
