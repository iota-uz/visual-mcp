import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Script } from "../../../../../packages/video/src/contracts";
import { SceneNavigator, StoryboardEditor } from "./StoryboardEditor";

const document = Script.parse({
  language: "ru",
  writingSystem: "cyrillic",
  title: "Test",
  premise: "A useful product story",
  sceneOrder: ["opening", "proof"],
  scenesById: {
    opening: {
      purpose: "Hook",
      narration: "Start with the customer problem.",
      onScreenText: [],
      visual: { description: "Product in use", shot: "Closeup", motion: "Push in" },
      shotOrder: [],
      shotsById: {},
      claims: [],
    },
    proof: {
      purpose: "Proof",
      narration: "",
      onScreenText: [],
      visual: { description: "", shot: "", motion: "" },
      shotOrder: [],
      shotsById: {},
      claims: [],
    },
  },
});

test("scene navigator communicates selection and brief readiness", async () => {
  const onSelect = vi.fn();
  render(<SceneNavigator document={document} selectedId="opening" onSelect={onSelect} />);
  expect(screen.getByRole("button", { name: /Hook/ })).toHaveAttribute("aria-current", "true");
  expect(screen.getByLabelText("Scene brief ready")).toBeInTheDocument();
  expect(screen.getByLabelText("Scene brief incomplete")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /Proof/ }));
  expect(onSelect).toHaveBeenCalledWith("proof");
});

function sceneItem(name: RegExp): HTMLElement {
  const card = screen.getByRole("button", { name });
  const item = card.closest(".video-scene-item");
  if (!(item instanceof HTMLElement)) throw new Error("Expected a scene item wrapper");
  return item;
}

test("scene context menu stages deletion only", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const onDeleteScene = vi.fn();
  render(
    <SceneNavigator
      document={document}
      selectedId="opening"
      onSelect={onSelect}
      onDeleteScene={onDeleteScene}
    />,
  );
  const proof = screen.getByRole("button", { name: /Proof/ });
  fireEvent.contextMenu(proof, { clientX: 60, clientY: 120 });
  expect(screen.getByRole("menu")).toHaveAccessibleName("Scene 2 actions");
  // Opening the menu selects its target, like the canvas does.
  expect(onSelect).toHaveBeenCalledWith("proof");
  // Reordering moved to drag-and-drop; the menu only stages deletion.
  expect(screen.queryByRole("menuitem", { name: "Move earlier" })).not.toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Move later" })).not.toBeInTheDocument();
  expect(screen.getByRole("menuitem", { name: "Delete scene…" })).toHaveClass("is-danger");
  await user.click(screen.getByRole("menuitem", { name: "Delete scene…" }));
  expect(onDeleteScene).toHaveBeenCalledWith("proof");
});

test("scene list reorders by drag and drop", () => {
  const onReorderScenes = vi.fn();
  render(
    <SceneNavigator
      document={document}
      selectedId="opening"
      onSelect={vi.fn()}
      onReorderScenes={onReorderScenes}
    />,
  );
  const proof = sceneItem(/Proof/);
  const opening = sceneItem(/Hook/);
  fireEvent.dragStart(proof);
  expect(proof).toHaveClass("is-dragging");
  fireEvent.dragOver(opening);
  expect(opening).toHaveClass("is-drop-target");
  fireEvent.drop(opening);
  // The dragged scene takes the target's place.
  expect(onReorderScenes).toHaveBeenCalledWith(["proof", "opening"]);
  fireEvent.dragEnd(proof);
  expect(proof).not.toHaveClass("is-dragging");
  expect(opening).not.toHaveClass("is-drop-target");
});

test("dropping a scene onto itself keeps the order", () => {
  const onReorderScenes = vi.fn();
  render(
    <SceneNavigator
      document={document}
      selectedId="opening"
      onSelect={vi.fn()}
      onReorderScenes={onReorderScenes}
    />,
  );
  const proof = sceneItem(/Proof/);
  fireEvent.dragStart(proof);
  fireEvent.dragOver(proof);
  fireEvent.drop(proof);
  expect(onReorderScenes).not.toHaveBeenCalled();
});

test("keyboard reorder nudges the focused scene with Alt plus arrows", () => {
  const onReorderScenes = vi.fn();
  render(
    <SceneNavigator
      document={document}
      selectedId="opening"
      onSelect={vi.fn()}
      onReorderScenes={onReorderScenes}
    />,
  );
  const proof = screen.getByRole("button", { name: /Proof/ });
  expect(proof).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
  expect(screen.getByText(/Drag to reorder/)).toBeInTheDocument();
  fireEvent.keyDown(proof, { key: "ArrowUp", altKey: true });
  expect(onReorderScenes).toHaveBeenCalledWith(["proof", "opening"]);
  // The last scene cannot move later.
  fireEvent.keyDown(proof, { key: "ArrowDown", altKey: true });
  expect(onReorderScenes).toHaveBeenCalledTimes(1);
});

test("sorting is unavailable while scenes are locked or single", () => {
  const onReorderScenes = vi.fn();
  const view = render(
    <SceneNavigator
      document={document}
      selectedId="opening"
      onSelect={vi.fn()}
      onReorderScenes={onReorderScenes}
      scenesLocked
    />,
  );
  const proofCard = screen.getByRole("button", { name: /Proof/ });
  expect(proofCard.closest(".video-scene-item")).not.toHaveAttribute("draggable");
  expect(proofCard).not.toHaveAttribute("aria-keyshortcuts");
  expect(screen.queryByText(/Drag to reorder/)).not.toBeInTheDocument();
  fireEvent.keyDown(proofCard, { key: "ArrowUp", altKey: true });
  expect(onReorderScenes).not.toHaveBeenCalled();
  const single = Script.parse({
    ...document,
    sceneOrder: ["opening"],
    scenesById: { opening: document.scenesById.opening },
  });
  view.rerender(
    <SceneNavigator
      document={single}
      selectedId="opening"
      onSelect={vi.fn()}
      onReorderScenes={onReorderScenes}
    />,
  );
  const hook = screen.getByRole("button", { name: /Hook/ });
  expect(hook.closest(".video-scene-item")).not.toHaveAttribute("draggable");
});

test("scene cards keep the browser menu without handlers", () => {
  render(<SceneNavigator document={document} selectedId="opening" onSelect={vi.fn()} />);
  const event = fireEvent.contextMenu(screen.getByRole("button", { name: /Hook/ }), {
    clientX: 60,
    clientY: 120,
  });
  expect(event).toBe(true);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});

test("board shows every scene before any editor opens", () => {
  render(
    <StoryboardEditor
      document={document}
      onChange={vi.fn()}
      disabled={false}
      selectedId="proof"
    />,
  );
  expect(screen.queryByRole("navigation", { name: "Scenes" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Edit scene 1/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Edit scene 2/ })).toBeInTheDocument();
  expect(screen.getByText("Start with the customer problem.")).toBeInTheDocument();
  expect(screen.getByLabelText("Scene brief ready")).toBeInTheDocument();
  expect(screen.getByLabelText("Scene brief incomplete")).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Scene purpose" })).not.toBeInTheDocument();
  expect(screen.queryByText(/brief fields/)).not.toBeInTheDocument();
});

test("premise stays a logline until edited", async () => {
  const user = userEvent.setup();
  render(<StoryboardEditor document={document} onChange={vi.fn()} disabled={false} />);
  expect(screen.getByRole("button", { name: "A useful product story" })).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Main idea" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "A useful product story" }));
  expect(screen.getByRole("textbox", { name: "Main idea" })).toHaveValue("A useful product story");
});

test("clicking a beat opens its editor and Escape collapses it", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(
    <StoryboardEditor
      document={document}
      onChange={vi.fn()}
      disabled={false}
      selectedId="opening"
      onSelect={onSelect}
    />,
  );
  await user.click(screen.getByRole("button", { name: /Edit scene 2/ }));
  expect(onSelect).toHaveBeenCalledWith("proof");
  expect(screen.getByRole("textbox", { name: "Scene purpose" })).toHaveValue("Proof");
  expect(screen.queryByText(/brief fields/)).not.toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("textbox", { name: "Scene purpose" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Edit scene 2/ })).toBeInTheDocument();
});

test("uses constrained camera controls and normalizes legacy labels", async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(
    <StoryboardEditor
      document={document}
      onChange={onChange}
      disabled={false}
      selectedId="opening"
    />,
  );
  await user.click(screen.getByRole("button", { name: /Edit scene 1/ }));

  expect(screen.getByRole("combobox", { name: "Framing" })).toHaveValue("close-up");
  expect(screen.getByRole("radio", { name: /Push in/ })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: /Pull out/ }));

  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({
      scenesById: expect.objectContaining({
        opening: expect.objectContaining({
          visual: expect.objectContaining({ motion: "pull-out" }),
        }),
      }),
    }),
  );
});

test("presents imported framing as not set instead of editable provenance", async () => {
  const user = userEvent.setup();
  const opening = document.scenesById.opening;
  if (!opening) throw new Error("Expected opening scene fixture");
  const imported = Script.parse({
    ...document,
    scenesById: {
      ...document.scenesById,
      opening: {
        ...opening,
        visual: { ...opening.visual, shot: "Imported" },
      },
    },
  });
  render(
    <StoryboardEditor document={imported} onChange={vi.fn()} disabled={false} selectedId="opening" />,
  );
  await user.click(screen.getByRole("button", { name: /Edit scene 1/ }));
  expect(screen.getByRole("combobox", { name: "Framing" })).toHaveValue("");
  expect(screen.queryByDisplayValue("Imported")).not.toBeInTheDocument();
});

test("disabled snapshot is a board without editors", () => {
  render(<StoryboardEditor document={document} onChange={vi.fn()} disabled />);
  expect(screen.getByText("Hook")).toBeInTheDocument();
  expect(screen.getByText("Proof")).toBeInTheDocument();
  expect(screen.getByText("Start with the customer problem.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Edit scene/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Add scene" })).not.toBeInTheDocument();
});

function beatItem(name: string): HTMLElement {
  const handle = screen.getByRole("button", { name });
  const item = handle.closest(".video-beat");
  if (!(item instanceof HTMLElement)) throw new Error("Expected a beat wrapper");
  return item;
}

test("beats reorder from the index handle", () => {
  const onReorderScenes = vi.fn();
  render(
    <StoryboardEditor
      document={document}
      onChange={vi.fn()}
      disabled={false}
      onReorderScenes={onReorderScenes}
    />,
  );
  const proof = beatItem("Reorder scene 2");
  const opening = beatItem("Reorder scene 1");
  fireEvent.dragStart(screen.getByRole("button", { name: "Reorder scene 2" }));
  expect(proof).toHaveClass("is-dragging");
  fireEvent.dragOver(opening);
  expect(opening).toHaveClass("is-drop-target");
  fireEvent.drop(opening);
  expect(onReorderScenes).toHaveBeenCalledWith(["proof", "opening"]);
});

test("board Alt plus arrows nudges the focused beat", () => {
  const onReorderScenes = vi.fn();
  render(
    <StoryboardEditor
      document={document}
      onChange={vi.fn()}
      disabled={false}
      onReorderScenes={onReorderScenes}
    />,
  );
  const proof = screen.getByRole("button", { name: "Reorder scene 2" });
  fireEvent.keyDown(proof, { key: "ArrowUp", altKey: true });
  expect(onReorderScenes).toHaveBeenCalledWith(["proof", "opening"]);
});
