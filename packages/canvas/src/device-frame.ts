/**
 * Built-in device and browser shells for iframe nodes.
 *
 * `frame.kind: "phone"` is the canonical OSAGO handset and nothing else: it
 * pins one screen size and draws no browser chrome, so a *web* mockup — the
 * common case — had to be faked by hand-authoring a fake toolbar inside the
 * screen HTML, which then shipped inside every snapshot and PNG.
 *
 * `frame.kind: "device"` replaces that with named presets. A preset owns its
 * own default viewport, so authoring a mockup is `{kind:"device",
 * preset:"iphone-safari"}` with no measurements at all, and the shell is
 * drawn by the canvas the same way in the viewer, the public share, PNG and
 * PDF. The registry is the extension point: a new device is a new entry
 * here plus its id in `DEVICE_PRESET_IDS`, with no renderer changes.
 */

import { PHONE_FRAME } from "./phone-frame.js";

export const DEVICE_PRESET_IDS = ["iphone-safari", "desktop-safari"] as const;
export type DevicePresetId = (typeof DEVICE_PRESET_IDS)[number];

/**
 * What the frame does with content taller than the screen.
 *
 * `clip` is a real device: the screen is exactly the preset's viewport and
 * anything past it is cut off (and scrollable, since the screen is live).
 * `full-height` is the long-screenshot mockup: the screen grows to the
 * requested viewport height so a whole page is visible inside the shell at
 * once, chrome still attached.
 */
export const DEVICE_DISPLAYS = ["clip", "full-height"] as const;
export type DeviceDisplay = (typeof DEVICE_DISPLAYS)[number];

export interface DevicePreset {
  id: DevicePresetId;
  label: string;
  /** Rounded handset body, or a squared desktop window. */
  form: "phone" | "window";
  /** Content area the screen HTML is authored against, before `full-height`. */
  viewport: { width: number; height: number };
  /** Border thickness of the body — a handset bezel or a window edge. */
  bezel: number;
  /** Gap between the bezel and the screen. */
  padding: number;
  radius: number;
  screenRadius: number;
  /** iOS status bar. 0 on desktop. */
  statusHeight: number;
  /** Safari controls. */
  toolbarHeight: number;
  toolbarPlacement: "top" | "bottom";
  /** Placeholder address shown when the node does not set one. */
  defaultUrl: string;
}

export const DEVICE_PRESETS: Record<DevicePresetId, DevicePreset> = {
  /*
   * Deliberately the same outer body as PHONE_FRAME (310x708): the two shells
   * sit side by side on real canvases, and a web mockup that rendered 40px
   * taller than the app mockup beside it would read as a different device.
   * The Safari toolbar is taken out of the content area, not added to the
   * body: 40 status + 590 content + 52 toolbar = the phone's 682 screen.
   */
  "iphone-safari": {
    id: "iphone-safari",
    label: "iPhone · Safari",
    form: "phone",
    viewport: { width: 284, height: 590 },
    bezel: PHONE_FRAME.bezel,
    padding: PHONE_FRAME.padding,
    radius: PHONE_FRAME.radius,
    screenRadius: PHONE_FRAME.screenRadius,
    statusHeight: PHONE_FRAME.statusHeight,
    toolbarHeight: 52,
    toolbarPlacement: "bottom",
    defaultUrl: "example.com",
  },
  "desktop-safari": {
    id: "desktop-safari",
    label: "Desktop · Safari",
    form: "window",
    viewport: { width: 1280, height: 800 },
    bezel: 1,
    padding: 0,
    radius: 12,
    screenRadius: 11,
    statusHeight: 0,
    toolbarHeight: 52,
    toolbarPlacement: "top",
    defaultUrl: "example.com",
  },
};

/** The node caption sits above the shell and is not part of the device. */
export const DEVICE_CAPTION_HEIGHT = PHONE_FRAME.captionHeight;

export function devicePreset(id: DevicePresetId): DevicePreset {
  return DEVICE_PRESETS[id];
}

/** Content height a preset uses when the node does not ask for a taller one. */
export function deviceViewportHeight(id: DevicePresetId, requested?: number): number {
  const preset = DEVICE_PRESETS[id];
  return Math.max(preset.viewport.height, requested ?? preset.viewport.height);
}

/** Outer body size, chrome included, at scale 1. */
export function deviceShellSize(
  id: DevicePresetId,
  viewportHeight?: number,
): { width: number; height: number; screenHeight: number } {
  const preset = DEVICE_PRESETS[id];
  const screenHeight =
    preset.statusHeight + preset.toolbarHeight + deviceViewportHeight(id, viewportHeight);
  const inset = 2 * (preset.bezel + preset.padding);
  return {
    width: preset.viewport.width + inset,
    height: screenHeight + inset,
    screenHeight,
  };
}

/** Node height that shows the whole shell at a given node width, caption included. */
export function deviceNodeHeightForWidth(
  id: DevicePresetId,
  width: number,
  viewportHeight?: number,
): number {
  const shell = deviceShellSize(id, viewportHeight);
  return DEVICE_CAPTION_HEIGHT + (width / shell.width) * shell.height;
}

/** Node width that shows the whole shell at a given node height. */
export function deviceNodeWidthForHeight(
  id: DevicePresetId,
  height: number,
  viewportHeight?: number,
): number {
  const shell = deviceShellSize(id, viewportHeight);
  return ((height - DEVICE_CAPTION_HEIGHT) * shell.width) / shell.height;
}

/** Uniform scale that fits the shell inside the node's box. */
export function deviceFrameScale(
  id: DevicePresetId,
  nodeWidth: number,
  nodeHeight: number,
  viewportHeight?: number,
): number {
  const shell = deviceShellSize(id, viewportHeight);
  return Math.min(
    nodeWidth / shell.width,
    Math.max(1, nodeHeight - DEVICE_CAPTION_HEIGHT) / shell.height,
  );
}

const STATUS_ICONS = `<span class="vc-device-status-icons" aria-hidden="true">
  <svg width="16" height="10" viewBox="0 0 16 10"><rect y="7" width="2.5" height="3" rx="1" fill="currentColor"/><rect x="4.3" y="5" width="2.5" height="5" rx="1" fill="currentColor"/><rect x="8.6" y="2.5" width="2.5" height="7.5" rx="1" fill="currentColor"/><rect x="12.9" width="2.5" height="10" rx="1" fill="currentColor"/></svg>
  <svg width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M2 4.5a7.1 7.1 0 0110 0M4.2 6.6a4 4 0 015.6 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="7" cy="8.4" r="1.1" fill="currentColor"/></svg>
  <svg width="21" height="10" viewBox="0 0 21 10" fill="none"><rect x=".7" y=".7" width="17" height="8.6" rx="2.4" stroke="currentColor" stroke-opacity=".45" stroke-width="1.2"/><rect x="2.2" y="2.2" width="12.8" height="5.6" rx="1.2" fill="currentColor"/><path d="M19 3.3v3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
</span>`;

const CHEVRON_LEFT = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEVRON_RIGHT = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const SHARE_ICON = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M5 14v5a2 2 0 002 2h10a2 2 0 002-2v-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const TABS_ICON = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="6" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 6V5a2 2 0 012-2h9a2 2 0 012 2v9a2 2 0 01-2 2h-1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const LOCK_ICON = `<svg class="vc-device-lock" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 10V7a4 4 0 118 0v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function addressBar(url: string): string {
  return `<span class="vc-device-url">${LOCK_ICON}<span>${escapeText(url)}</span></span>`;
}

function safariToolbar(preset: DevicePreset, url: string): string {
  if (preset.form === "window") {
    return `<div class="vc-device-toolbar vc-device-toolbar-top"><span class="vc-device-lights" aria-hidden="true"><i></i><i></i><i></i></span><span class="vc-device-nav" aria-hidden="true">${CHEVRON_LEFT}${CHEVRON_RIGHT}</span>${addressBar(url)}<span class="vc-device-nav" aria-hidden="true">${SHARE_ICON}${TABS_ICON}</span></div>`;
  }
  return `<div class="vc-device-toolbar vc-device-toolbar-bottom">${addressBar(url)}<span class="vc-device-nav" aria-hidden="true">${CHEVRON_LEFT}${CHEVRON_RIGHT}${SHARE_ICON}${TABS_ICON}</span></div>`;
}

export interface RenderDeviceFrameOptions {
  preset: DevicePresetId;
  /** The iframe element or its placeholder. */
  screenContent: string;
  /** Content area actually in use — `full-height` makes this taller. */
  viewport: { width: number; height: number };
  display: DeviceDisplay;
  url?: string;
  /** iOS status-bar clock. */
  time?: string;
  scale: number;
}

/** Canvas-owned device shell: bezel, iOS status bar and Safari controls. */
export function renderDeviceFrame(options: RenderDeviceFrameOptions): string {
  const preset = DEVICE_PRESETS[options.preset];
  const shell = deviceShellSize(options.preset, options.viewport.height);
  const url = options.url ?? preset.defaultUrl;
  const status =
    preset.statusHeight > 0
      ? `<div class="vc-device-status"><span>${escapeText(options.time ?? "09:42")}</span>${STATUS_ICONS}</div>`
      : "";
  const toolbar = safariToolbar(preset, url);
  const content = `<div class="vc-device-content"><div class="vc-iframe-viewport" style="width:${options.viewport.width}px;height:${options.viewport.height}px">${options.screenContent}</div></div>`;
  const stack =
    preset.toolbarPlacement === "top"
      ? `${status}${toolbar}${content}`
      : `${status}${content}${toolbar}`;
  return `<div class="vc-device-shell vc-device-${preset.form} vc-device-${preset.id}" data-display="${options.display}" style="--vc-device-scale:${options.scale};--vc-device-width:${shell.width}px;--vc-device-height:${shell.height}px;--vc-device-screen-height:${shell.screenHeight}px;--vc-device-bezel:${preset.bezel}px;--vc-device-padding:${preset.padding}px;--vc-device-radius:${preset.radius}px;--vc-device-screen-radius:${preset.screenRadius}px;--vc-device-status-height:${preset.statusHeight}px;--vc-device-toolbar-height:${preset.toolbarHeight}px"><div class="vc-device-screen">${stack}</div></div>`;
}
