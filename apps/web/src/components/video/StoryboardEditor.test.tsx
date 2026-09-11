import { render, screen } from "@testing-library/react";
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
