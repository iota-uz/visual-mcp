/**
 * Theme -> Tailwind v4 `@theme` CSS compiler (PLAN.md sections 2.4, 11).
 *
 * Tailwind v4 is CSS-config-first: there is no `tailwind.config.js`.
 * Design tokens are declared as CSS custom properties inside an `@theme { }`
 * block, which Tailwind reads at build time to generate utility classes
 * (e.g. `--color-primary` -> `bg-primary`, `text-primary`, ...;
 * `--radius-md` -> `rounded-md`; `--shadow-lg` -> `shadow-lg`;
 * `--font-sans` -> `font-sans`; `--spacing-lg` -> `p-lg`, `gap-lg`, ...).
 *
 * See https://tailwindcss.com/docs/theme for the `--<namespace>-<name>`
 * convention this compiler follows.
 *
 * Usage (per PLAN.md section 3.1, injected into an HTML document's
 * `<style>` block alongside `@import "tailwindcss";`):
 *
 *   const css = compileThemeToTailwindV4(getTheme("clean-saas")!);
 *   const html = `<style>@import "tailwindcss";\n${css}</style>`;
 */

import type { Theme } from "../../types.js";

/**
 * Sanitizes a theme token key (e.g. a `spacing`/`shadows` record key) into a
 * safe CSS custom-property name segment. Theme data in this module already
 * uses safe keys (xs, sm, md, 2xl, ...), but this guards against future/
 * external theme data with arbitrary keys.
 */
function sanitizeSegment(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Emits one `--namespace-key: value;` line, indented for the `@theme` block. */
function line(namespace: string, key: string, value: string): string {
  const segment = sanitizeSegment(key);
  const name = segment ? `--${namespace}-${segment}` : `--${namespace}`;
  return `  ${name}: ${value};`;
}

function themeLines(theme: Theme): string[] {
  const lines = [
    line("color", "background", theme.colors.background),
    line("color", "foreground", theme.colors.foreground),
    line("color", "muted", theme.colors.muted),
    line("color", "surface", theme.colors.surface),
    line("color", "muted-foreground", theme.colors.mutedForeground),
    line("color", "success", theme.colors.success),
    line("color", "warning", theme.colors.warning),
    line("color", "danger", theme.colors.danger),
    line("color", "primary", theme.colors.primary),
    line("color", "secondary", theme.colors.secondary),
    line("color", "border", theme.colors.border),
    line("font", "sans", theme.typography.fontSans),
    line("font", "mono", theme.typography.fontMono),
    line("radius", "sm", theme.radius.sm),
    line("radius", "md", theme.radius.md),
    line("radius", "lg", theme.radius.lg),
    line("radius", "xl", theme.radius.xl),
  ];
  for (const [key, value] of Object.entries(theme.spacing)) lines.push(line("spacing", key, value));
  for (const [key, value] of Object.entries(theme.shadows)) lines.push(line("shadow", key, value));
  theme.chartPalette.forEach((color, index) => {
    lines.push(line("color", `chart-${index + 1}`, color));
  });
  lines.push(line("diagram", "node-radius", theme.diagramStyle.nodeRadius));
  lines.push(line("diagram", "edge-style", theme.diagramStyle.edgeStyle));
  return lines;
}

/** Runtime custom properties for HTML/native documents, applied before first paint. */
export function compileThemeToCssVariables(theme: Theme, selector = ":root"): string {
  const safeSelector = selector === ":root" ? selector : "[data-visual-canvas-root]";
  return `/* theme: ${theme.name} */\n${safeSelector} {\n${themeLines(theme).join("\n")}\n}\n`;
}

/**
 * Compiles a `Theme` into a Tailwind v4 `@theme { ... }` CSS block.
 *
 * Mapping:
 *   - colors.*        -> --color-background, --color-foreground, --color-muted,
 *                         --color-primary, --color-secondary, --color-border
 *   - typography.*    -> --font-sans, --font-mono
 *   - radius.*        -> --radius-sm, --radius-md, --radius-lg, --radius-xl
 *   - spacing[key]     -> --spacing-<key> for every key in the record
 *   - shadows[key]     -> --shadow-<key> for every key in the record
 *   - chartPalette[i] -> --color-chart-1, --color-chart-2, ... (1-indexed;
 *                         these double as Tailwind color utilities, e.g.
 *                         `bg-chart-1`, and as a lookup array for chart
 *                         authoring code, e.g. `var(--color-chart-1)`)
 *   - diagramStyle.*  -> --diagram-node-radius, --diagram-edge-style (not a
 *                         Tailwind utility-generating namespace; consumed
 *                         directly by the D2 wrapper / diagram styling code
 *                         via `var(--diagram-node-radius)` etc.)
 *
 * The returned string is a standalone `@theme { ... }` block — no
 * `@import "tailwindcss";` is included, since that directive is document-
 * level, not theme-level (see PLAN.md section 3.1 for how the two combine).
 */
export function compileThemeToTailwindV4(theme: Theme): string {
  const lines: string[] = [];

  lines.push(`/* theme: ${theme.name} */`);
  lines.push(`@theme {`);

  lines.push(...themeLines(theme));

  lines.push(`}`);

  return `${lines.join("\n")}\n`;
}
