import type { ThemeOverride } from "@visual-canvas/canvas/themes.js";
import { v } from "convex/values";

export const ThemeIdValidator = v.union(
  v.literal("clean-saas"),
  v.literal("minimal-docs"),
  v.literal("dark-terminal"),
  v.literal("startup-pitch"),
);

const ThemeColorsOverrideValidator = v.object({
  background: v.optional(v.string()),
  foreground: v.optional(v.string()),
  muted: v.optional(v.string()),
  surface: v.optional(v.string()),
  mutedForeground: v.optional(v.string()),
  success: v.optional(v.string()),
  warning: v.optional(v.string()),
  danger: v.optional(v.string()),
  primary: v.optional(v.string()),
  secondary: v.optional(v.string()),
  border: v.optional(v.string()),
});

export const ThemeOverrideValidator = v.object({
  colors: v.optional(ThemeColorsOverrideValidator),
  typography: v.optional(
    v.object({ fontSans: v.optional(v.string()), fontMono: v.optional(v.string()) }),
  ),
  radius: v.optional(
    v.object({
      sm: v.optional(v.string()),
      md: v.optional(v.string()),
      lg: v.optional(v.string()),
      xl: v.optional(v.string()),
    }),
  ),
  spacing: v.optional(v.record(v.string(), v.string())),
  shadows: v.optional(v.record(v.string(), v.string())),
  chartPalette: v.optional(v.array(v.string())),
  diagramStyle: v.optional(
    v.object({ nodeRadius: v.optional(v.string()), edgeStyle: v.optional(v.string()) }),
  ),
});

export type StoredThemeOverride = ThemeOverride;
