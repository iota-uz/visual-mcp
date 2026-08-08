/**
 * Concrete theme token data (PLAN.md sections 2.4, 11).
 *
 * Four initial themes, each a fully-populated `Theme` (see /src/types.ts):
 *   - clean-saas     — light, modern SaaS product UI look.
 *   - minimal-docs    — understated, editorial documentation look.
 *   - dark-terminal   — dark, monospace-leaning terminal/hacker look.
 *   - startup-pitch   — bold, vibrant pitch-deck look.
 *
 * These are the single source of truth for theme values. Do not hardcode
 * theme colors/tokens anywhere else — import `THEMES` / `getTheme` from
 * `./index.js` instead.
 */

import type { Theme, ThemeName } from "../../types.js";

/* ------------------------------------------------------------------------
 * clean-saas — light modern SaaS look
 * ---------------------------------------------------------------------- */

const cleanSaas: Theme = {
  name: "clean-saas",
  colors: {
    background: "#ffffff",
    foreground: "#0f172a",
    muted: "#64748b",
    primary: "#2563eb",
    secondary: "#7c3aed",
    border: "#e2e8f0",
  },
  typography: {
    fontSans: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    fontMono: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
  },
  radius: {
    sm: "0.25rem",
    md: "0.5rem",
    lg: "0.75rem",
    xl: "1rem",
  },
  spacing: {
    xs: "0.25rem",
    sm: "0.5rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
    "2xl": "3rem",
    "3xl": "4rem",
  },
  shadows: {
    sm: "0 1px 2px 0 rgb(15 23 42 / 0.05)",
    md: "0 4px 6px -1px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.06)",
    lg: "0 10px 15px -3px rgb(15 23 42 / 0.08), 0 4px 6px -4px rgb(15 23 42 / 0.06)",
    xl: "0 20px 25px -5px rgb(15 23 42 / 0.1), 0 8px 10px -6px rgb(15 23 42 / 0.06)",
  },
  chartPalette: [
    "#2563eb",
    "#7c3aed",
    "#0ea5e9",
    "#14b8a6",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#22c55e",
  ],
  diagramStyle: {
    nodeRadius: "8px",
    edgeStyle: "rounded",
  },
};

/* ------------------------------------------------------------------------
 * minimal-docs — understated, editorial documentation look
 * ---------------------------------------------------------------------- */

const minimalDocs: Theme = {
  name: "minimal-docs",
  colors: {
    background: "#fafaf9",
    foreground: "#1c1917",
    muted: "#78716c",
    primary: "#1c1917",
    secondary: "#b45309",
    border: "#e7e5e4",
  },
  typography: {
    fontSans: "'Charter', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
    fontMono: "'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace",
  },
  radius: {
    sm: "0.125rem",
    md: "0.25rem",
    lg: "0.375rem",
    xl: "0.5rem",
  },
  spacing: {
    xs: "0.375rem",
    sm: "0.75rem",
    md: "1.25rem",
    lg: "2rem",
    xl: "3rem",
    "2xl": "4.5rem",
    "3xl": "6rem",
  },
  shadows: {
    sm: "0 1px 1px 0 rgb(28 25 23 / 0.04)",
    md: "0 1px 3px 0 rgb(28 25 23 / 0.06)",
    lg: "0 2px 6px 0 rgb(28 25 23 / 0.07)",
    xl: "0 4px 12px 0 rgb(28 25 23 / 0.08)",
  },
  chartPalette: [
    "#1c1917",
    "#b45309",
    "#78716c",
    "#57534e",
    "#a8a29e",
    "#92400e",
    "#44403c",
    "#d6d3d1",
  ],
  diagramStyle: {
    nodeRadius: "2px",
    edgeStyle: "straight",
  },
};

/* ------------------------------------------------------------------------
 * dark-terminal — dark, monospace-leaning terminal look
 * ---------------------------------------------------------------------- */

const darkTerminal: Theme = {
  name: "dark-terminal",
  colors: {
    background: "#0b0e14",
    foreground: "#c9d1d9",
    muted: "#6e7681",
    primary: "#39d353",
    secondary: "#58a6ff",
    border: "#21262d",
  },
  typography: {
    fontSans: "'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Consolas, monospace",
    fontMono: "'JetBrains Mono', 'Fira Code', 'SFMono-Regular', Consolas, monospace",
  },
  radius: {
    sm: "0.125rem",
    md: "0.25rem",
    lg: "0.375rem",
    xl: "0.5rem",
  },
  spacing: {
    xs: "0.25rem",
    sm: "0.5rem",
    md: "0.875rem",
    lg: "1.25rem",
    xl: "1.75rem",
    "2xl": "2.5rem",
    "3xl": "3.5rem",
  },
  shadows: {
    sm: "0 0 0 1px rgb(0 0 0 / 0.3)",
    md: "0 0 12px 0 rgb(57 211 83 / 0.12), 0 1px 2px 0 rgb(0 0 0 / 0.4)",
    lg: "0 0 24px 0 rgb(57 211 83 / 0.15), 0 4px 8px 0 rgb(0 0 0 / 0.5)",
    xl: "0 0 40px 0 rgb(88 166 255 / 0.18), 0 8px 16px 0 rgb(0 0 0 / 0.55)",
  },
  chartPalette: [
    "#39d353",
    "#58a6ff",
    "#f778ba",
    "#e3b341",
    "#79c0ff",
    "#d2a8ff",
    "#ff7b72",
    "#56d4dd",
  ],
  diagramStyle: {
    nodeRadius: "2px",
    edgeStyle: "orthogonal",
  },
};

/* ------------------------------------------------------------------------
 * startup-pitch — bold, vibrant pitch-deck look
 * ---------------------------------------------------------------------- */

const startupPitch: Theme = {
  name: "startup-pitch",
  colors: {
    background: "#ffffff",
    foreground: "#1e1b4b",
    muted: "#6b7280",
    primary: "#7c3aed",
    secondary: "#f97316",
    border: "#ede9fe",
  },
  typography: {
    fontSans: "'Poppins', 'Segoe UI', -apple-system, sans-serif",
    fontMono: "'Space Mono', 'SFMono-Regular', Consolas, monospace",
  },
  radius: {
    sm: "0.5rem",
    md: "1rem",
    lg: "1.5rem",
    xl: "2rem",
  },
  spacing: {
    xs: "0.5rem",
    sm: "1rem",
    md: "1.75rem",
    lg: "2.5rem",
    xl: "4rem",
    "2xl": "6rem",
    "3xl": "8rem",
  },
  shadows: {
    sm: "0 2px 4px 0 rgb(124 58 237 / 0.08)",
    md: "0 8px 16px -4px rgb(124 58 237 / 0.18), 0 2px 6px -2px rgb(249 115 22 / 0.1)",
    lg: "0 16px 32px -8px rgb(124 58 237 / 0.22), 0 4px 12px -4px rgb(249 115 22 / 0.14)",
    xl: "0 28px 56px -12px rgb(124 58 237 / 0.28), 0 8px 20px -6px rgb(249 115 22 / 0.16)",
  },
  chartPalette: [
    "#7c3aed",
    "#f97316",
    "#ec4899",
    "#06b6d4",
    "#facc15",
    "#22c55e",
    "#6366f1",
    "#ef4444",
  ],
  diagramStyle: {
    nodeRadius: "20px",
    edgeStyle: "curved",
  },
};

/** All initial themes, keyed by `Theme.name` / `ThemeName`. */
export const THEMES: Record<ThemeName, Theme> = {
  "clean-saas": cleanSaas,
  "minimal-docs": minimalDocs,
  "dark-terminal": darkTerminal,
  "startup-pitch": startupPitch,
};
