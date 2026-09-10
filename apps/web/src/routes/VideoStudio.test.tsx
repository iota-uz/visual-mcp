import { render, screen, within } from "@testing-library/react";
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
  useAction: () => vi.fn(),
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
  expect(screen.getByDisplayValue("uz narration")).toBeInTheDocument();
});

test("renders honest empty media state and no human approval shortcut", () => {
  mount();
  expect(screen.getByRole("heading", { name: "No rendered video yet" })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /approve|generate|render/i }),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText("Main idea").tagName).toBe("TEXTAREA");
  expect(screen.getByLabelText("Narration")).toHaveValue("ru narration");
  expect(screen.getByRole("navigation", { name: "Scenes" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Opening/ })).toHaveAttribute("aria-current", "true");
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
  await user.click(screen.getByRole("button", { name: "Add caption" }));
  expect(screen.getByRole("region", { name: "Selected clip settings" })).toBeInTheDocument();
  expect(screen.getByLabelText("Caption text")).toBeInTheDocument();
});

test("language switch reads independent draft and blocks while edits are unsaved", async () => {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole("button", { name: "O‘zbekcha" }));
  expect(screen.getByLabelText("Narration")).toHaveValue("uz narration");
  await user.type(screen.getByLabelText("Narration"), " changed");
  expect(screen.getByRole("button", { name: "Русский" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save version" })).toBeDisabled();
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
  expect(screen.getByLabelText("Narration")).toHaveValue("ru narration");
  expect(screen.getByLabelText("Narration")).toHaveAttribute("readonly");
});

test("script writes use exact draft revision and scoped canonical paths", async () => {
  const save = vi.fn().mockResolvedValue({ revisionId: "saved" });
  mutation.mockReturnValue(save);
  const user = userEvent.setup();
  mount();
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
