import { CanvasFileSchema } from "@visual-canvas/canvas/types.js";
import { normalizeCanvasPath } from "@visual-canvas/runtime/paths/index.js";
import { z } from "zod";

export const HtmlSchema = z
  .string()
  .min(1)
  .max(1_000_000)
  .describe("Raw HTML authored directly in this MCP call. No local file or upload required.");
export const ViewportSchema = z
  .object({
    width: z.number().int().min(1).max(8192),
    height: z.number().int().min(1).max(8192),
  })
  .strict();
export const ScreensSchema = z
  .array(
    z
      .object({
        id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/),
        title: z.string().min(1).max(240).optional(),
        html: HtmlSchema.optional().describe(
          "Omit to reuse the top-level html without repeating it.",
        ),
        route: z
          .string()
          .regex(/^#\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/)
          .optional(),
        viewport: ViewportSchema.optional(),
      })
      .strict(),
  )
  .min(1)
  .max(50)
  .describe(
    "Complete screen set, laid out automatically. Replaces canvas pages/prototype; use canvas_edit for incremental HTML edits.",
  );

export type HtmlAuthoringInput = {
  html?: string;
  screens?: z.infer<typeof ScreensSchema>;
  viewport?: z.infer<typeof ViewportSchema>;
  title?: string;
  kind?: string;
  doc?: unknown;
  files?: Array<{ path: string }>;
};

/** Expand compact authoring to the existing atomic document + source commit. */
export function expandHtmlAuthoring(input: HtmlAuthoringInput) {
  if (input.html === undefined && input.screens === undefined) {
    if (input.viewport !== undefined)
      throw new Error("invalid_input: viewport requires html or screens");
    return null;
  }
  if (input.doc !== undefined || (input.kind !== undefined && input.kind !== "canvas")) {
    throw new Error(
      "invalid_input: html/screens create kind=canvas; do not combine them with doc or another kind",
    );
  }
  const screens = input.screens ?? [{ id: "index", title: input.title }];
  const ids = new Set<string>();
  const files: Array<{ path: string; text: string }> = [];
  const viewports = screens.map(
    (screen) => screen.viewport ?? input.viewport ?? { width: 1280, height: 800 },
  );
  const columns = Math.min(3, screens.length);
  const cellWidth = Math.max(...viewports.map((v) => v.width)) + 80;
  const cellHeight = Math.max(...viewports.map((v) => v.height)) + 120;
  const sharedPath = "/src/screens/index.html";
  let usesShared = false;
  const nodes = screens.map((screen, index) => {
    if (ids.has(screen.id)) throw new Error(`invalid_input: duplicate screen id ${screen.id}`);
    ids.add(screen.id);
    const html = screen.html ?? input.html;
    if (html === undefined || !html.trim())
      throw new Error(`invalid_input: screen ${screen.id} requires html`);
    const path = screen.html === undefined ? sharedPath : `/src/screens/${screen.id}.html`;
    if (screen.html === undefined) usesShared = true;
    else files.push({ path, text: html });
    const viewport = screen.viewport ?? input.viewport ?? { width: 1280, height: 800 };
    return {
      kind: "iframe" as const,
      id: screen.id,
      caption: { title: screen.title ?? screen.id },
      rect: {
        x: 40 + (index % columns) * cellWidth,
        y: 60 + Math.floor(index / columns) * cellHeight,
        w: viewport.width,
        h: viewport.height,
      },
      source: { entrypoint: path, ...(screen.route ? { route: screen.route } : {}) },
      viewport,
      frame: { kind: "none" as const },
    };
  });
  if (usesShared && input.html !== undefined) files.push({ path: sharedPath, text: input.html });
  const paths = new Set<string>();
  for (const file of [...files, ...(input.files ?? [])]) {
    const path = normalizeCanvasPath(file.path, "write", "path").displayPath;
    if (paths.has(path))
      throw new Error(`invalid_input: HTML shorthand conflicts with file ${path}`);
    paths.add(path);
  }
  if (files.length + (input.files?.length ?? 0) > 500)
    throw new Error("invalid_input: at most 500 files per save");
  const doc = CanvasFileSchema.parse({
    version: 3,
    defaultPageId: "screens",
    pages: [
      {
        id: "screens",
        title: input.title ?? "Screens",
        order: 0,
        doc: {
          version: 2,
          title: input.title ?? "Screens",
          world: {
            width: columns * cellWidth,
            height: Math.ceil(screens.length / columns) * cellHeight,
          },
          nodes,
        },
      },
    ],
    prototype: { interactions: [] },
  });
  return { doc, files };
}
