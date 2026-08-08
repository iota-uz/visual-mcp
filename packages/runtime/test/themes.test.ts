/**
 * Tests for the theme system (PLAN.md sections 2.4, 11).
 *
 * Test runner: node:test + node:assert/strict (see test/types.test.ts for
 * the established pattern).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compileThemeToTailwindV4,
  getTheme,
  isThemeName,
  listThemes,
} from "../src/render/themes/index.js";
import type { Theme } from "../src/types.js";
import { THEME_NAMES } from "../src/types.js";

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

function assertIsTheme(theme: Theme, expectedName: string): void {
  assert.equal(theme.name, expectedName);

  // colors
  for (const key of [
    "background",
    "foreground",
    "muted",
    "primary",
    "secondary",
    "border",
  ] as const) {
    assert.match(
      theme.colors[key],
      HEX_RE,
      `colors.${key} should be a hex color, got ${theme.colors[key]}`,
    );
  }

  // typography
  assert.equal(typeof theme.typography.fontSans, "string");
  assert.ok(theme.typography.fontSans.length > 0);
  assert.equal(typeof theme.typography.fontMono, "string");
  assert.ok(theme.typography.fontMono.length > 0);

  // radius
  for (const key of ["sm", "md", "lg", "xl"] as const) {
    assert.equal(typeof theme.radius[key], "string");
    assert.ok(theme.radius[key].length > 0);
  }

  // spacing / shadows are non-empty records of strings
  assert.ok(Object.keys(theme.spacing).length > 0);
  for (const value of Object.values(theme.spacing)) {
    assert.equal(typeof value, "string");
  }
  assert.ok(Object.keys(theme.shadows).length > 0);
  for (const value of Object.values(theme.shadows)) {
    assert.equal(typeof value, "string");
  }

  // chartPalette
  assert.ok(Array.isArray(theme.chartPalette));
  assert.ok(theme.chartPalette.length >= 4, "expect a usable chart palette");
  for (const color of theme.chartPalette) {
    assert.match(color, HEX_RE);
  }

  // diagramStyle
  assert.equal(typeof theme.diagramStyle.nodeRadius, "string");
  assert.ok(theme.diagramStyle.nodeRadius.length > 0);
  assert.equal(typeof theme.diagramStyle.edgeStyle, "string");
  assert.ok(theme.diagramStyle.edgeStyle.length > 0);
}

test("THEME_NAMES lists exactly the 4 initial themes from PLAN.md section 11", () => {
  assert.deepEqual(
    [...THEME_NAMES].sort(),
    ["clean-saas", "dark-terminal", "minimal-docs", "startup-pitch"].sort(),
  );
});

test("listThemes returns all 4 themes, each conforming to the Theme shape", () => {
  const themes = listThemes();
  assert.equal(themes.length, THEME_NAMES.length);
  for (const name of THEME_NAMES) {
    const theme = themes.find((t) => t.name === name);
    assert.ok(theme, `expected listThemes() to include ${name}`);
    assertIsTheme(theme!, name);
  }
});

for (const name of THEME_NAMES) {
  test(`getTheme("${name}") returns a well-formed Theme`, () => {
    const theme = getTheme(name);
    assert.ok(theme);
    assertIsTheme(theme!, name);
  });
}

test("getTheme returns undefined for an unknown theme name", () => {
  assert.equal(getTheme("does-not-exist"), undefined);
});

test("isThemeName narrows valid vs invalid theme name strings", () => {
  assert.equal(isThemeName("clean-saas"), true);
  assert.equal(isThemeName("nonsense"), false);
});

test("themes are visually distinct (no two share primary+background)", () => {
  const themes = listThemes();
  const signatures = themes.map((t) => `${t.colors.background}|${t.colors.primary}`);
  assert.equal(new Set(signatures).size, signatures.length);
});

test("dark-terminal is actually dark (dark background, light foreground)", () => {
  const theme = getTheme("dark-terminal")!;
  // crude luminance check via hex -> sum of channels
  const toLuminanceProxy = (hex: string): number => {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return r + g + b;
  };
  assert.ok(
    toLuminanceProxy(theme.colors.background) < toLuminanceProxy(theme.colors.foreground),
    "dark-terminal background should be darker than its foreground",
  );
});

/* ------------------------------------------------------------------------
 * compileThemeToTailwindV4
 * ---------------------------------------------------------------------- */

test("compileThemeToTailwindV4 produces a non-empty @theme block", () => {
  const theme = getTheme("clean-saas")!;
  const css = compileThemeToTailwindV4(theme);
  assert.equal(typeof css, "string");
  assert.ok(css.length > 0);
  assert.match(css, /@theme\s*\{/);
  assert.match(css, /\}\s*$/);
});

test("compileThemeToTailwindV4 emits expected custom properties for clean-saas", () => {
  const theme = getTheme("clean-saas")!;
  const css = compileThemeToTailwindV4(theme);
  assert.match(css, /--color-background:\s*#ffffff;/);
  assert.match(css, /--color-primary:\s*#2563eb;/);
  assert.match(css, /--font-sans:\s*Inter/);
  assert.match(css, /--radius-md:\s*0\.5rem;/);
  assert.match(css, /--color-chart-1:\s*#2563eb;/);
  assert.match(css, /--diagram-node-radius:\s*8px;/);
  assert.match(css, /--diagram-edge-style:\s*rounded;/);
});

test("compileThemeToTailwindV4 emits expected custom properties for dark-terminal", () => {
  const theme = getTheme("dark-terminal")!;
  const css = compileThemeToTailwindV4(theme);
  assert.match(css, /--color-background:\s*#0b0e14;/);
  assert.match(css, /--color-primary:\s*#39d353;/);
  assert.match(css, /--font-mono:/);
  assert.match(css, /--diagram-edge-style:\s*orthogonal;/);
});

test("compileThemeToTailwindV4 emits expected custom properties for minimal-docs", () => {
  const theme = getTheme("minimal-docs")!;
  const css = compileThemeToTailwindV4(theme);
  assert.match(css, /--color-background:\s*#fafaf9;/);
  assert.match(css, /--radius-sm:\s*0\.125rem;/);
  assert.match(css, /--diagram-edge-style:\s*straight;/);
});

test("compileThemeToTailwindV4 emits expected custom properties for startup-pitch", () => {
  const theme = getTheme("startup-pitch")!;
  const css = compileThemeToTailwindV4(theme);
  assert.match(css, /--color-primary:\s*#7c3aed;/);
  assert.match(css, /--color-secondary:\s*#f97316;/);
  assert.match(css, /--radius-xl:\s*2rem;/);
  assert.match(css, /--diagram-edge-style:\s*curved;/);
});

test("compileThemeToTailwindV4 emits a --color-chart-N var for every chartPalette entry", () => {
  for (const name of THEME_NAMES) {
    const theme = getTheme(name)!;
    const css = compileThemeToTailwindV4(theme);
    theme.chartPalette.forEach((color, i) => {
      const re = new RegExp(`--color-chart-${i + 1}:\\s*${color.replace("#", "#")};`);
      assert.match(css, re, `missing --color-chart-${i + 1} for ${name}`);
    });
  }
});

test("compileThemeToTailwindV4 output is well-formed enough to embed in a <style> block", () => {
  const theme = getTheme("startup-pitch")!;
  const css = compileThemeToTailwindV4(theme);
  const html = `<style>@import "tailwindcss";\n${css}</style>`;
  // no unescaped closing </style> from theme content, and braces balance
  assert.equal((css.match(/\{/g) ?? []).length, (css.match(/\}/g) ?? []).length);
  assert.ok(!css.includes("</style>"));
  assert.ok(html.includes('@import "tailwindcss";'));
});
