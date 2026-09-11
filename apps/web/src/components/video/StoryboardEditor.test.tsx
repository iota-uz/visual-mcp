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

test("shell can own navigation without duplicating it in the editor", () => {
  render(
    <StoryboardEditor
      document={document}
      onChange={vi.fn()}
      disabled={false}
      selectedId="proof"
      showSceneNavigator={false}
    />,
  );
  expect(screen.queryByRole("navigation", { name: "Scenes" })).not.toBeInTheDocument();
  expect(screen.getByDisplayValue("Proof")).toBeInTheDocument();
  expect(screen.getByText(/1\/3 brief fields/)).toBeInTheDocument();
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
      showSceneNavigator={false}
    />,
  );

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

test("presents imported framing as not set instead of editable provenance", () => {
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
    <StoryboardEditor
      document={imported}
      onChange={vi.fn()}
      disabled={false}
      selectedId="opening"
      showSceneNavigator={false}
    />,
  );
  expect(screen.getByRole("combobox", { name: "Framing" })).toHaveValue("");
  expect(screen.queryByDisplayValue("Imported")).not.toBeInTheDocument();
});
