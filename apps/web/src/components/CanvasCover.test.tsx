import { fireEvent, render, screen } from "@testing-library/react";
import type { CanvasPoster } from "@visual-canvas/canvas/poster.js";
import { describe, expect, it } from "vitest";
import { CanvasCover } from "./CanvasCover";

/*
 * Four states, and the order between them is the whole component: a real
 * render always wins, the schematic is the fallback, an empty canvas is a
 * different fact from a canvas nobody has computed a cover for, and a kind
 * with no document at all gets a plate.
 */

const poster: CanvasPoster = {
  format: 1,
  ar: 1.5,
  n: 2,
  p: 1,
  rects: [
    { x: 0, y: 0, w: 400, h: 500, r: "primary" },
    { x: 600, y: 200, w: 400, h: 500, k: "iframe" },
  ],
};

const art = (container: HTMLElement) => container.querySelector(".canvas-cover-art");

describe("CanvasCover", () => {
  it("prefers the real render when there is one", () => {
    const { container } = render(
      <CanvasCover kind="canvas" poster={poster} thumbnailUrl="https://example.test/x.png" />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "https://example.test/x.png");
    expect(art(container)).toBeNull();
  });

  it("falls back to the poster when there is no render", () => {
    const { container } = render(<CanvasCover kind="canvas" poster={poster} thumbnailUrl={null} />);
    expect(art(container)?.querySelectorAll("i")).toHaveLength(2);
  });

  /*
   * A signed thumbnail URL expires and its storage object can go missing.
   * That used to degrade to "No render yet"; now it degrades to the
   * schematic, which is still a picture of the right canvas.
   */
  it("falls back to the poster when the render's URL is dead", () => {
    const { container } = render(
      <CanvasCover kind="canvas" poster={poster} thumbnailUrl="https://example.test/gone.png" />,
    );
    const image = container.querySelector("img");
    if (!image) throw new Error("expected an image to fail");
    fireEvent.error(image);
    expect(container.querySelector("img")).toBeNull();
    expect(art(container)?.querySelectorAll("i")).toHaveLength(2);
  });

  it("draws an empty canvas as an empty canvas, not as a missing cover", () => {
    const { container } = render(
      <CanvasCover kind="canvas" poster={{ ...poster, n: 0, rects: [] }} />,
    );
    expect(container.querySelector(".canvas-cover-art.is-empty")).toBeInTheDocument();
    expect(container.querySelector(".canvas-cover-fallback")).toBeNull();
  });

  it("gives a kind with no document its kind plate", () => {
    const { container } = render(<CanvasCover kind="pdf" poster={null} thumbnailUrl={null} />);
    expect(container.querySelector(".canvas-cover-fallback")).toBeInTheDocument();
  });

  it("carries lane role and node kind onto the blocks, for the stylesheet", () => {
    const { container } = render(<CanvasCover kind="canvas" poster={poster} />);
    const blocks = [...(art(container)?.querySelectorAll("i") ?? [])];
    expect(blocks[0]).toHaveAttribute("data-role", "primary");
    expect(blocks[1]).toHaveAttribute("data-kind", "iframe");
  });

  it("says nothing to a screen reader — it is decoration", () => {
    render(<CanvasCover kind="canvas" poster={poster} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
