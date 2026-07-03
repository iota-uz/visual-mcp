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

  // Colors
  lines.push(line("color", "background", theme.colors.background));
  lines.push(line("color", "foreground", theme.colors.foreground));
  lines.push(line("color", "muted", theme.colors.muted));
  lines.push(line("color", "primary", theme.colors.primary));
  lines.push(line("color", "secondary", theme.colors.secondary));
  lines.push(line("color", "border", theme.colors.border));

  // Typography
  lines.push(line("font", "sans", theme.typography.fontSans));
  lines.push(line("font", "mono", theme.typography.fontMono));

  // Radius
  lines.push(line("radius", "sm", theme.radius.sm));
  lines.push(line("radius", "md", theme.radius.md));
  lines.push(line("radius", "lg", theme.radius.lg));
  lines.push(line("radius", "xl", theme.radius.xl));

  // Spacing (arbitrary key set)
  for (const [key, value] of Object.entries(theme.spacing)) {
    lines.push(line("spacing", key, value));
  }

  // Shadows (arbitrary key set)
  for (const [key, value] of Object.entries(theme.shadows)) {
    lines.push(line("shadow", key, value));
  }

  // Chart palette -> --color-chart-1..N (also usable as bg-chart-1 etc.)
  theme.chartPalette.forEach((color, i) => {
    lines.push(line("color", `chart-${i + 1}`, color));
  });

  // Diagram styling hints (plain custom properties, non-Tailwind namespace)
  lines.push(line("diagram", "node-radius", theme.diagramStyle.nodeRadius));
  lines.push(line("diagram", "edge-style", theme.diagramStyle.edgeStyle));

  lines.push(`}`);

  return lines.join("\n") + "\n";
}
