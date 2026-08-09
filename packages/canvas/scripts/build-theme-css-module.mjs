// Emits dist/theme-css.js/.d.ts exporting THEME_CSS as a string constant,
// generated from src/theme.css so it cannot drift. Needed because Convex's
// bundler (unlike a browser/Vite build) has no CSS loader — it can only
// import JS/TS modules — so environments that assemble a full render-worker
// HTML page server-side (no bundler, no <link>) need the stylesheet as data.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(`${root}/src/theme.css`, "utf8");

writeFileSync(`${root}/dist/theme-css.js`, `export const THEME_CSS = ${JSON.stringify(css)};\n`);
writeFileSync(`${root}/dist/theme-css.d.ts`, "export declare const THEME_CSS: string;\n");
