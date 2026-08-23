import { z } from "zod";

const CssTokenSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^{};<>]+$/, "theme tokens must be single safe CSS values");

export const THEME_IDS = ["clean-saas", "minimal-docs", "dark-terminal", "startup-pitch"] as const;
export const ThemeIdSchema = z.enum(THEME_IDS);
export type ThemeId = z.infer<typeof ThemeIdSchema>;

export const ThemeColorsSchema = z
  .object({
    background: CssTokenSchema,
    foreground: CssTokenSchema,
    muted: CssTokenSchema,
    surface: CssTokenSchema,
    mutedForeground: CssTokenSchema,
    success: CssTokenSchema,
    warning: CssTokenSchema,
    danger: CssTokenSchema,
    primary: CssTokenSchema,
    secondary: CssTokenSchema,
    border: CssTokenSchema,
  })
  .strict();
export const ThemeTypographySchema = z
  .object({ fontSans: CssTokenSchema, fontMono: CssTokenSchema })
  .strict();
export const ThemeRadiusSchema = z
  .object({ sm: CssTokenSchema, md: CssTokenSchema, lg: CssTokenSchema, xl: CssTokenSchema })
  .strict();
export const ThemeDiagramStyleSchema = z
  .object({ nodeRadius: CssTokenSchema, edgeStyle: CssTokenSchema })
  .strict();

export const ThemeSchema = z
  .object({
    name: ThemeIdSchema,
    colors: ThemeColorsSchema,
    typography: ThemeTypographySchema,
    radius: ThemeRadiusSchema,
    spacing: z.record(CssTokenSchema),
    shadows: z.record(CssTokenSchema),
    chartPalette: z.array(CssTokenSchema).min(4).max(12),
    diagramStyle: ThemeDiagramStyleSchema,
  })
  .strict();
export type Theme = z.infer<typeof ThemeSchema>;

/** A partial semantic token layer; nested groups merge field by field. */
export const ThemeOverrideSchema = z
  .object({
    colors: ThemeColorsSchema.partial().optional(),
    typography: ThemeTypographySchema.partial().optional(),
    radius: ThemeRadiusSchema.partial().optional(),
    spacing: z.record(CssTokenSchema).optional(),
    shadows: z.record(CssTokenSchema).optional(),
    chartPalette: z.array(CssTokenSchema).min(4).max(12).optional(),
    diagramStyle: ThemeDiagramStyleSchema.partial().optional(),
  })
  .strict();
export type ThemeOverride = z.infer<typeof ThemeOverrideSchema>;
