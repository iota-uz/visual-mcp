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

  test("renders a waveform face for audio cards instead of placeholder copy", () => {
    const { container } = render(
      <AssetPreview assetId="audio-throw" kind="audio" name="Throw" previewUrl="/throw.ogg" />,
    );

    expect(screen.queryByText("Audio · open to listen")).not.toBeInTheDocument();
    expect(container.querySelector(".asset-audio-wave")).toBeTruthy();
    expect(container.querySelector(".asset-audio-disc")).toBeTruthy();
    expect(screen.queryByLabelText("Audio preview of Throw")).not.toBeInTheDocument();
  });

  test("keeps two audio assets visually distinct from each other", () => {
    const first = render(
      <AssetPreview assetId="audio-throw" kind="audio" name="Throw" previewUrl="/throw.ogg" />,
    );
    const waveA = first.container.querySelector(".asset-audio-wave")?.innerHTML;
    first.unmount();

    const second = render(
      <AssetPreview assetId="audio-land" kind="audio" name="Land" previewUrl="/land.ogg" />,
    );
    const waveB = second.container.querySelector(".asset-audio-wave")?.innerHTML;

    expect(waveA).toBeTruthy();
    expect(waveB).toBeTruthy();
    expect(waveA).not.toEqual(waveB);
  });

  test("makes the full audio preview playable", () => {
    const { container } = render(
      <AssetPreview
        assetId="audio-throw"
        kind="audio"
        name="Throw"
        previewUrl="/throw.ogg"
        mode="full"
        eager
      />,
    );

    expect(container.querySelector(".asset-audio-wave")).toBeTruthy();
    expect(screen.getByLabelText("Audio preview of Throw")).toHaveAttribute("controls");
  });

  test("marks video cards with a play glyph", async () => {
    const { container } = render(
      <AssetPreview assetId="video-1" kind="video" name="Demo" previewUrl="/demo.mp4" />,
    );

    expect(await screen.findByLabelText("Preview of Demo")).toBeInTheDocument();
    expect(container.querySelector(".asset-video-play")).toBeTruthy();
  });

  test("does not put a play glyph on the full video preview", async () => {
    const { container } = render(
      <AssetPreview
        assetId="video-1"
        kind="video"
        name="Demo"
        previewUrl="/demo.mp4"
        mode="full"
        eager
      />,
    );

    expect(await screen.findByLabelText("Preview of Demo")).toBeInTheDocument();
    expect(container.querySelector(".asset-video-play")).toBeNull();
  });

  test("separates image and svg preview grounds by class", async () => {
    const { container, rerender } = render(
      <AssetPreview assetId="image-1" kind="image" name="Photo" previewUrl="/photo.png" />,
    );
    expect(container.querySelector(".asset-preview-content-image")).toBeTruthy();
    expect(container.querySelector(".asset-preview-content-svg")).toBeNull();

    rerender(<AssetPreview assetId="svg-1" kind="svg" name="Logo" previewUrl="/logo.svg" />);
    expect(await screen.findByAltText("Preview of Logo")).toBeInTheDocument();
    expect(container.querySelector(".asset-preview-content-svg")).toBeTruthy();
  });

  test("keeps a data watermark behind JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }),
    );
    const { container } = render(
      <AssetPreview assetId="data-3" kind="data" name="Claims" previewUrl="/claims.json" />,
    );

    expect(container.querySelector(".asset-data-mark")).toHaveTextContent("{ }");
    expect(await screen.findByLabelText("JSON preview of Claims")).toBeInTheDocument();
  });
});
