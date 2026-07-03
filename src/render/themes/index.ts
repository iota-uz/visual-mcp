/**
 * Theme system public entrypoint (PLAN.md sections 2.4, 11).
 *
 * Other modules (server, templates, playwright-renderer) should import
 * exclusively from this file:
 *
 *   import {
 *     getTheme,
 *     listThemes,
 *     compileThemeToTailwindV4,
 *   } from "../render/themes/index.js";
 *
 *   const theme = getTheme("clean-saas"); // Theme | undefined
 *   const css = compileThemeToTailwindV4(theme!);
 *   // css === '/* theme: clean-saas *\/\n@theme {\n  --color-background: #ffffff;\n  ...\n}\n'
 */

import type { Theme, ThemeName } from "../../types.js";
import { THEME_NAMES } from "../../types.js";
import { THEMES } from "./data.js";

export { compileThemeToTailwindV4 } from "./compile.js";
export { THEMES } from "./data.js";

/** Type guard: is `name` one of the four initial theme names? */
export function isThemeName(name: string): name is ThemeName {
  return (THEME_NAMES as readonly string[]).includes(name);
}

/**
 * Looks up a theme by name.
 *
 * @param name - Theme name, e.g. "clean-saas". Accepts a plain `string` (not
 *   just `ThemeName`) so callers can pass user/LLM-supplied input directly
 *   without a separate cast; unknown names resolve to `undefined` rather
 *   than throwing.
 * @returns The matching `Theme`, or `undefined` if `name` is not a known
 *   theme.
 */
export function getTheme(name: string): Theme | undefined {
  return isThemeName(name) ? THEMES[name] : undefined;
}

/** Returns all available themes, in `THEME_NAMES` order. */
export function listThemes(): Theme[] {
  return THEME_NAMES.map((name) => THEMES[name]);
}
