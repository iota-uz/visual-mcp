import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AssetPreview } from "./AssetPreview";

describe("AssetPreview", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("renders actual image and SVG content", async () => {
    const { rerender } = render(
      <AssetPreview assetId="image-1" kind="image" name="Photo" previewUrl="/photo.png" />,
    );
    expect(await screen.findByAltText("Preview of Photo")).toHaveAttribute("src", "/photo.png");

    rerender(<AssetPreview assetId="svg-1" kind="svg" name="Logo" previewUrl="/logo.svg" />);
    expect(await screen.findByAltText("Preview of Logo")).toHaveAttribute("src", "/logo.svg");
  });

  test("keeps card videos passive and makes the full preview playable", async () => {
    const { rerender } = render(
      <AssetPreview assetId="video-1" kind="video" name="Demo" previewUrl="/demo.mp4" />,
    );
    const video = await screen.findByLabelText("Preview of Demo");
    expect(video).not.toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");

    rerender(
      <AssetPreview
        assetId="video-1"
        kind="video"
        name="Demo"
        previewUrl="/demo.mp4"
        mode="full"
        eager
      />,
    );
    expect(video).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("autoplay");
  });

  test("formats JSON as text instead of injecting markup", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ title: "<b>OSAGO</b>", count: 2 }) }),
    );
    render(<AssetPreview assetId="data-1" kind="data" name="Claims" previewUrl="/claims.json" />);

    const preview = await screen.findByLabelText("JSON preview of Claims");
    expect(preview).toHaveTextContent('"title": "<b>OSAGO</b>"');
    expect(preview.querySelector("b")).toBeNull();
  });

  test("falls back when a preview cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<AssetPreview assetId="data-2" kind="data" name="Claims" previewUrl="/missing.json" />);

    await waitFor(() => expect(screen.getByText("Preview unavailable")).toBeInTheDocument());
  });
});
