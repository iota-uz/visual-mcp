/**
 * D2 diagram wrapper (PLAN.md section 3.2, 8.3).
 *
 * Owner: D2 rendering task. Compiles D2 source to SVG.
 *
 * Package decision: use `@terrastruct/d2` (D2.js, npm, WASM build of the D2
 * compiler/layout engine) via its Node ESM/CJS API — it is a real, actively
 * maintained package with `.d.ts` types and no shell-out required. Do NOT
 * shell out to a local `d2` CLI binary; that fallback is unnecessary here.
 *
 * Pipeline (PLAN.md 8.3): D2 source -> SVG render -> optional HTML wrapper
 * -> PNG/PDF embedding. This module only implements the first step (D2
 * source -> SVG string). HTML wrapping and PNG/PDF embedding are done by
 * the playwright-renderer module, which embeds the SVG string this module
 * returns directly into an HTML document (inline `<svg>`) before
 * screenshotting/printing it.
 *
 * Runtime notes (see also PLAN.md section 9 — sandbox must not require
 * external network):
 *
 * - `@terrastruct/d2` is WASM-based and 100% local: it loads `d2.wasm` from
 *   disk and runs it inside a `node:worker_threads` Worker. No network
 *   access is performed at compile or render time, so this satisfies the
 *   "no external network" sandbox policy for free.
 * - `new D2()` spins up a dedicated worker thread and is comparatively
 *   expensive to create, so we lazily create ONE instance and reuse it for
 *   the lifetime of the process (module-level singleton), rather than
 *   spinning up a worker per render call.
 * - IMPORTANT BUG WORKAROUND: `D2.compile()`/`D2.render()` resolve a single
 *   internal `currentResolve`/`currentReject` pair per call
 *   (dist/node-esm/index.js). If two calls are in flight concurrently on
 *   the *same* `D2` instance, the second call's resolver silently clobbers
 *   the first's, and the first call's promise never settles (verified: it
 *   hangs indefinitely rather than throwing). We work around this by
 *   funneling all compile/render calls through an internal FIFO queue
 *   (`runExclusive`) so only one compile-or-render is ever in flight on the
 *   shared instance at a time. Concurrent `renderD2ToSvg()` callers are
 *   still safe to call concurrently from outside this module — they just
 *   get serialized internally.
 * - The worker thread is a Node `Worker` handle, which keeps the process
 *   event loop alive. For long-running processes (the MCP server) this is
 *   desirable (the singleton lives for the process lifetime). For
 *   short-lived processes (tests, CLI scripts) call `disposeD2Renderer()`
 *   once done so the process can exit cleanly; this module also registers
 *   a best-effort cleanup on `process.exit`... intentionally does NOT do
 *   so automatically, since a long-lived MCP server should keep the worker
 *   alive across many tool calls. Callers that need a clean exit (like our
 *   own test suite) must call `disposeD2Renderer()` explicitly.
 */

import type { RenderOptions } from "@terrastruct/d2";
import { D2 } from "@terrastruct/d2";

/**
 * Error thrown by {@link renderD2ToSvg} when D2 source fails to compile or
 * render. Always has a human-readable `.message` suitable for surfacing
 * back to an LLM caller via the MCP `render_file` tool — it is never a raw
 * process crash.
 */
export class D2RenderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "D2RenderError";
  }
}

/**
 * Render options accepted by {@link renderD2ToSvg}. Subset of D2.js's
 * `RenderOptions` that callers of this module are expected to tune; layout
 * engine selection lives here too since it is applied at compile time.
 */
export interface D2RenderToSvgOptions extends RenderOptions {
  /** Layout engine to use [default: 'dagre']. */
  layout?: "dagre" | "elk";
}

/** Lazily-created singleton D2 instance (see module header for rationale). */
let sharedD2: D2 | null = null;

/** FIFO serialization queue — see "BUG WORKAROUND" note in the module header. */
let queueTail: Promise<unknown> = Promise.resolve();

function getSharedD2(): D2 {
  if (!sharedD2) {
    sharedD2 = new D2();
  }
  return sharedD2;
}

/**
 * Runs `fn` after all previously-queued work on the shared D2 instance has
 * settled, and ensures later work waits for `fn` too — this is what keeps
 * concurrent `renderD2ToSvg()` calls from tripping the D2.js resolver bug.
 */
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const result = queueTail.then(fn, fn);
  // Swallow rejections here so one failed render doesn't wedge the queue
  // for subsequent, unrelated calls; the real rejection still propagates
  // to the caller via `result`.
  queueTail = result.catch(() => undefined);
  return result;
}

function formatD2Error(err: unknown): string {
  if (err instanceof Error) {
    // D2.js surfaces compiler diagnostics as a JSON-encoded array of
    // { range, errmsg } objects inside Error#message. Try to pretty-print
    // that into readable "line: message" text; fall back to the raw
    // message for anything else (e.g. plain string errors).
    try {
      const parsed: unknown = JSON.parse(err.message);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .map((entry) => {
            if (
              entry &&
              typeof entry === "object" &&
              "errmsg" in entry &&
              typeof (entry as { errmsg: unknown }).errmsg === "string"
            ) {
              return (entry as { errmsg: string }).errmsg;
            }
            return JSON.stringify(entry);
          })
          .join("; ");
      }
    } catch {
      // Not JSON — fall through to the raw message.
    }
    return err.message;
  }
  return String(err);
}

/**
 * Compiles D2 diagram source text to a standalone, embeddable SVG string.
 *
 * This is the stable entry point future integration (the `render_file` MCP
 * tool, and the playwright-renderer/PDF pipeline for embedding diagrams
 * into HTML reports) should call when the render target is D2 source:
 *
 *   `renderD2ToSvg(source: string, options?: D2RenderToSvgOptions): Promise<string>`
 *
 * The returned string is a complete `<svg ...>...</svg>` document (no
 * leading `<?xml ...?>` declaration by default, so it can be embedded
 * inline into an HTML document or written directly to a `.svg` output
 * file). Pass `{ noXMLTag: false }` to get a standalone SVG file with the
 * XML declaration included.
 *
 * @throws {D2RenderError} if `source` fails to compile (D2 syntax errors)
 *   or fails to render. The error message is human-readable and safe to
 *   return to an LLM caller as-is.
 */
export async function renderD2ToSvg(
  source: string,
  options: D2RenderToSvgOptions = {},
): Promise<string> {
  if (typeof source !== "string" || source.trim().length === 0) {
    throw new D2RenderError("D2 source is empty — nothing to render.");
  }

  const { layout, ...renderOverrides } = options;
  const d2 = getSharedD2();

  const svg = await runExclusive(async () => {
    let diagram: Awaited<ReturnType<typeof d2.compile>>["diagram"];
    let renderOptions: RenderOptions;
    try {
      // NOTE: `@terrastruct/d2`'s .d.ts for the `compile(input: string,
      // options?)` overload types `options` as `Omit<CompileRequest, "fs">`
      // (i.e. `{ inputPath?; options: CompileOptions }`), but its README
      // and runtime implementation actually treat that second argument as
      // a flat `CompileOptions` object (see dist/node-esm/index.js). The
      // two overloads disagree with the package's own documented usage, so
      // we sidestep it entirely by using the fully-typed `CompileRequest`
      // object overload instead.
      const compileResult = await d2.compile({
        fs: { index: source },
        inputPath: "index",
        options: { layout: layout ?? "dagre" },
      });
      diagram = compileResult.diagram;
      renderOptions = compileResult.renderOptions;
    } catch (err) {
      throw new D2RenderError(`Failed to compile D2 source: ${formatD2Error(err)}`, { cause: err });
    }

    try {
      return await d2.render(diagram, {
        // D2's default ("SVG fitting to screen") omits width/height on the
        // root <svg> element, leaving only a viewBox. That's fine for a
        // standalone file opened directly in a browser, but breaks inline
        // embedding (PLAN.md 3.2/15: the SVG string is spliced straight
        // into an HTML <section>): with no width/height and no surrounding
        // CSS constraint, the browser stretches the root <svg> to 100% of
        // its container's width and scales height by the intrinsic aspect
        // ratio, which can blow a tall/narrow diagram up to thousands of
        // px tall and cascade into extra PDF pages. `scale: 1` makes D2
        // emit explicit width="<w>" height="<h>" matching the viewBox, so
        // the diagram renders at its natural pixel size when embedded.
        // Placed after `...renderOptions` (not before): D2.js's compiled
        // `renderOptions` always includes an explicit `scale: null` own
        // property (confirmed via `d2.compile()`'s output), and object
        // spread copies that key regardless of its value — so `scale: 1`
        // spread *before* `...renderOptions` would get immediately
        // clobbered back to `null`. Still placed before `...renderOverrides`
        // so an explicit caller override takes precedence over this default.
        ...renderOptions,
        scale: 1,
        noXMLTag: true,
        ...renderOverrides,
      });
    } catch (err) {
      throw new D2RenderError(
        `Failed to render compiled D2 diagram to SVG: ${formatD2Error(err)}`,
        { cause: err },
      );
    }
  });

  // When `noXMLTag` is left at its default (true) the result should start
  // directly with `<svg` (ready for inline embedding); when the caller
  // explicitly opts into the XML declaration it should still contain a
  // well-formed `<svg` document just not as the very first bytes.
  const expectsInlineSvg = renderOverrides.noXMLTag !== false;
  const isWellFormedSvg = expectsInlineSvg ? svg.trim().startsWith("<svg") : svg.includes("<svg");
  if (!svg || !isWellFormedSvg) {
    throw new D2RenderError("D2 renderer returned an unexpected (non-SVG) result.");
  }

  return svg;
}

/**
 * Releases the shared D2 worker thread. The `@terrastruct/d2` WASM engine
 * runs inside a `node:worker_threads` Worker, which otherwise keeps the
 * Node process's event loop alive indefinitely.
 *
 * Long-running processes (the MCP server) generally do NOT need to call
 * this — the singleton is meant to be reused for the process lifetime.
 * Short-lived processes (tests, one-off scripts) should call this once
 * they are done rendering so the process can exit cleanly.
 *
 * Safe to call even if no render has happened yet; safe to call more than
 * once. After disposal, the next `renderD2ToSvg()` call creates a fresh
 * worker on demand.
 */
export async function disposeD2Renderer(): Promise<void> {
  const instance = sharedD2;
  sharedD2 = null;
  queueTail = Promise.resolve();
  if (!instance) {
    return;
  }
  const worker = (instance as unknown as { worker?: { terminate(): Promise<number> } }).worker;
  if (worker && typeof worker.terminate === "function") {
    await worker.terminate();
  }
}
