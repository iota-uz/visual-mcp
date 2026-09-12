import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CharacterAnimationLab } from "./CharacterAnimationLab";

describe("CharacterAnimationLab", () => {
  it("sizes the preview and safe-frame container from the real scene aspect", () => {
    render(<CharacterAnimationLab scenarioId="stage-landscape" autoPlay={false} />);
    const stage = screen.getByTestId("character-stage");
    expect(stage).toHaveAttribute("data-stage-aspect", "16:9");
    expect(stage).toHaveStyle({ aspectRatio: "1920 / 1080" });
  });
  it("renders the exact production SVG scene and exposes frame controls", () => {
    render(<CharacterAnimationLab scenarioId="point" autoPlay={false} />);
    expect(screen.getByRole("img", { name: "Farq character animation lab" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Animation frame" })).toHaveValue("0");
    fireEvent.click(screen.getByRole("button", { name: "Next frame" }));
    expect(screen.getByRole("slider", { name: "Animation frame" })).toHaveValue("1");
    fireEvent.click(screen.getByRole("button", { name: "Previous frame" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous frame" }));
    expect(screen.getByRole("slider", { name: "Animation frame" })).toHaveValue("0");
  });

  it("switches scenarios and shows onion-skin production frames", () => {
    const { container } = render(<CharacterAnimationLab scenarioId="idle" autoPlay={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Talk \/ visemes/i }));
    expect(
      screen.getAllByText("Authored mouth shapes with an emotional performance layer."),
    ).toHaveLength(2);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(container.querySelectorAll(".cal-ghost svg")).toHaveLength(2);
  });

  it("opens a golden review at an exact authored frame", () => {
    render(<CharacterAnimationLab scenarioId="golden-ad" autoPlay={false} initialFrame={132} />);
    expect(screen.getByRole("slider", { name: "Animation frame" })).toHaveValue("132");
    expect(screen.getByText("00:04:12")).toBeInTheDocument();
  });
});
