import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, test, vi } from "vitest";
import { VideoStudioPage } from "./VideoStudio";

const { query, mutation, paginate } = vi.hoisted(() => ({
  query: vi.fn(),
  mutation: vi.fn(),
  paginate: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useQuery: query,
  useMutation: mutation,
  // VideoReview fires previewAsset on mount; a resolved no-op keeps the
  // review section mountable in route tests.
  useAction: () => vi.fn().mockResolvedValue({ url: "" }),
  usePaginatedQuery: paginate,
}));
const project = {
  projectId: "project",
  workspaceId: "workspace",
  title: "A real brief",
  brief: { topic: "Product demo", direction: "Show actual behaviour" },
  revisionId: "p1",
  drafts: [
    {
      draftId: "ru",
      language: "ru",
      scriptRevision: "s1",
      timelineRevision: "t1",
      currentVersionId: null,
    },
    {
      draftId: "uz",
      language: "uz",
      scriptRevision: "s2",
      timelineRevision: "t2",
      currentVersionId: null,
    },
  ],
};
function draft(language: "ru" | "uz") {
  return {
    draftId: language,
    projectId: "project",
    language,
    scriptRevision: `s-${language}`,
    timelineRevision: `t-${language}`,
    script: {
      language,
      writingSystem: language === "ru" ? "cyrillic" : "latin",
      title: language,
      premise: `${language} premise`,
      sceneOrder: ["opening"],
      scenesById: {
        opening: {
          purpose: "Opening",
          narration: `${language} narration`,
          onScreenText: [],
          visual: {
            description: "Actual product",
            shot: "Closeup",
            motion: "Still",
            keyframeOrder: [],
            keyframesById: {},
          },
          shotOrder: [],
          shotsById: {},
          claims: [],
        },
      },
    },
    timeline: {
      fps: { numerator: 30, denominator: 1 },
      durationFrames: 900,
      trackOrder: [],
      tracksById: {},
    },
  };
}
beforeEach(() => {
  query.mockImplementation((ref, args) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref);
    if (name === "video:getProject") return project;
    if (name === "video:getDraft") return draft(args.draftId);
    return undefined;
  });
  mutation.mockReturnValue(vi.fn().mockResolvedValue({ revisionId: "saved" }));
  paginate.mockReturnValue({ results: [], status: "Exhausted", loadMore: vi.fn() });
});
function mount(path = "/v/project") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/v/:projectId" element={<VideoStudioPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function openOpeningBeat() {
  fireEvent.click(screen.getByRole("button", { name: /Edit scene 1/ }));
  return screen.getByLabelText("Narration");
}

test("studio chrome exposes named workflow, language and production controls", () => {
  mount();
  expect(screen.getByRole("navigation", { name: "Studio workflow" })).toBeInTheDocument();
  for (const name of ["Story", "Shots", "Timeline", "Review"]) {
    expect(screen.getByRole("button", { name })).toBeEnabled();
  }
  expect(screen.getByRole("navigation", { name: "Draft language" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Русский" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "O‘zbekcha" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Open production" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
});

test("document undo is shared across Story, Shots and Timeline and remains available after mode switches", () => {
  mount();
  fireEvent.change(openOpeningBeat(), { target: { value: "Revised narration" } });
  fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
  const addCaption = screen.getAllByRole("button", { name: "Add caption" })[0];
  if (!addCaption) throw new Error("Expected caption action");
  fireEvent.click(addCaption);
  expect(screen.getByRole("button", { name: "Undo draft edit" })).toBeEnabled();
  fireEvent.keyDown(document.body, { key: "z", metaKey: true });
  expect(screen.queryByLabelText("Caption text")).not.toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: "z", metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Story" }));
  expect(screen.getByText("ru narration")).toBeInTheDocument();
  const narration = openOpeningBeat();
  expect(narration).toHaveValue("ru narration");
  fireEvent.keyDown(narration, {
    key: "Z",
    metaKey: true,
    shiftKey: true,
  });
  expect(screen.getByLabelText("Narration")).toHaveValue("Revised narration");
});

test("switching draft language resets documents and never carries history into the other language", () => {
  mount();
  fireEvent.change(openOpeningBeat(), { target: { value: "A local edit" } });
  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
  fireEvent.click(screen.getByRole("button", { name: "O‘zbekcha" }));
  expect(screen.getByText("uz narration")).toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: "z", ctrlKey: true, shiftKey: true });
  expect(screen.getByText("uz narration")).toBeInTheDocument();
  expect(openOpeningBeat()).toHaveValue("uz narration");
});

test("Review hides draft history and its shortcut cannot silently undo a script edit", () => {
  mount();
  fireEvent.change(openOpeningBeat(), {
    target: { value: "Keep this draft edit" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review" }));
  expect(screen.queryByRole("group", { name: "Draft edit history" })).not.toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Production readiness" })).not.toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: "z", metaKey: true });
  fireEvent.click(screen.getByRole("button", { name: "Story" }));
  expect(screen.getByText("Keep this draft edit")).toBeInTheDocument();
  expect(openOpeningBeat()).toHaveValue("Keep this draft edit");
});

test("UZ version deep link without language keeps the header and return lane Uzbek", async () => {
  const original = query.getMockImplementation();
  if (!original) throw new Error("Expected the query test double to be configured");
  query.mockImplementation((ref, args) =>
    getFunctionName(ref) === "video:getVersion" && args !== "skip"
      ? {
          version: { projectId: "project", language: "uz", versionId: "uz-version" },
          label: "Uzbek saved",
          script: draft("uz").script,
          timeline: draft("uz").timeline,
        }
      : original(ref, args),
  );
  mount("/v/project?version=uz-version");
  expect(screen.getByRole("button", { name: "O‘zbekcha" })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "Return to editable draft" }));
  expect(screen.getByText("uz narration")).toBeInTheDocument();
});

test("renders honest empty media state and no human approval shortcut", () => {
  mount();
  expect(screen.getByRole("heading", { name: "No rendered video yet" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /approve|generate|render/i }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "ru premise" })).toBeInTheDocument();
  expect(screen.getByText("ru narration")).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Scenes" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Edit scene 1/ })).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test("shots retain selected scene context instead of becoming an unlabelled empty form", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Shots" }));
  const context = screen.getByRole("region", { name: "Selected scene context" });
  expect(context).toHaveTextContent("Opening");
  expect(within(context).getByText("ru narration")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Plan the first shot" })).toBeInTheDocument();
});

test("timeline exposes a temporal workspace and focused caption controls", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Timeline" }));
  expect(screen.queryByRole("complementary", { name: "Project scenes" })).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Draft monitor" })).toBeInTheDocument();
  expect(screen.getByRole("slider", { name: "Playhead" })).toHaveValue("0");
  expect(screen.queryByRole("spinbutton", { name: "Sequence duration" })).not.toBeInTheDocument();
  expect(screen.getByText("Sequence length")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled();
  // Toolbar and empty-state affordances share one action; either adds the clip.
  const toolbarCaption = screen.getAllByRole("button", { name: "Add caption" }).at(0);
  if (!toolbarCaption) throw new Error("Expected an Add caption button");
  await user.click(toolbarCaption);
  expect(screen.getByRole("region", { name: "Selected clip settings" })).toBeInTheDocument();
  expect(screen.getByLabelText("Caption text")).toBeInTheDocument();
});

test("language switch reads independent draft and blocks while edits are unsaved", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "O‘zbekcha" }));
  expect(screen.getByText("uz narration")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Edit scene 1/ }));
  await user.type(screen.getByLabelText("Narration"), " changed");
  expect(screen.getByRole("button", { name: "Русский" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save version" })).toBeDisabled();
});

test("readiness pills navigate to the workspace that advances each count", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Shots" }));
  expect(screen.getByRole("heading", { name: "Shot production" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Open Story to review scene briefs" }));
  expect(screen.getByRole("button", { name: /Edit scene 1/ })).toBeInTheDocument();
  expect(screen.getByText("ru narration")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Open Shots to plan shots" }));
  expect(screen.getByRole("heading", { name: "Shot production" })).toBeInTheDocument();
});

test("pending render stays telemetry while a ready render is one click away", async () => {
  const original = query.getMockImplementation();
  if (!original) throw new Error("Expected the query test double to be configured");
  // Without a render the pill is plain status, not an invented action.
  mount();
  expect(screen.getByText("Render pending")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Review the latest render" }),
  ).not.toBeInTheDocument();
  query.mockImplementation((ref, args) =>
    getFunctionName(ref) === "video:latestRender" && args !== "skip"
      ? { jobId: "render-1" }
      : original(ref, args),
  );
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "Review the latest render" }));
  expect(await screen.findByText("Loading exact render…")).toBeInTheDocument();
});

test("language loading preserves the previous workspace as read-only context", async () => {
  const original = query.getMockImplementation();
  if (!original) throw new Error("Expected the query test double to be configured");
  query.mockImplementation((ref, args) => {
    if (getFunctionName(ref) === "video:getDraft" && args !== "skip" && args.draftId === "uz") {
      return undefined;
    }
    return original(ref, args);
  });
  mount();
  await userEvent.click(screen.getByRole("button", { name: "O‘zbekcha" }));
  expect(screen.getByText("Loading the Uzbek draft…")).toBeInTheDocument();
  expect(screen.getByText("ru narration")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Edit scene/ })).not.toBeInTheDocument();
});

test("scene context menu stages an armed delete confirmation", async () => {
  const save = vi.fn().mockResolvedValue({ revisionId: "saved" });
  mutation.mockReturnValue(save);
  const user = userEvent.setup();
  mount();
  const card = screen.getByRole("button", { name: /Opening/ });
  fireEvent.contextMenu(card, { clientX: 80, clientY: 140 });
  await user.click(screen.getByRole("menuitem", { name: "Delete scene…" }));
  // The menu decision is staged as an armed inline confirmation, not a
  // second resting Delete button.
  await user.click(screen.getByRole("button", { name: "Delete scene" }));
  await user.click(screen.getByRole("button", { name: "Save script now" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      draftId: "ru",
      expectedRevision: "s-ru",
      operations: expect.arrayContaining([
        expect.objectContaining({ path: "/sceneOrder", value: [] }),
      ]),
    }),
  );
});

test("script writes use exact draft revision and scoped canonical paths", async () => {
  const save = vi.fn().mockResolvedValue({ revisionId: "saved" });
  mutation.mockReturnValue(save);
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: /Edit scene 1/ }));
  await user.type(screen.getByLabelText("Narration"), " corrected");
  await user.click(screen.getByRole("button", { name: "Save script now" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      draftId: "ru",
      expectedRevision: "s-ru",
      idempotencyKey: expect.any(String),
      operations: expect.arrayContaining([expect.objectContaining({ path: "/scenesById" })]),
    }),
  );
});
