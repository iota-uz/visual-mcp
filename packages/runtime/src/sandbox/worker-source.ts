/**
 * Source of the sandbox worker, run inside a `node:worker_threads` Worker
 * via `{ eval: true }` (see run-code.ts).
 *
 * WHY A STRING INSTEAD OF A SIBLING .ts/.js FILE ON DISK
 * --------------------------------------------------------------------
 * This project runs from TypeScript source in dev/test via `tsx`
 * (`node --import tsx --test ...`, per package.json). `tsx` registers its
 * loader hooks (via `node:module`'s `register()`) in the *main* thread
 * only; empirically, on Node v22.14.0, those hooks do **not** propagate
 * to a `Worker`'s own entry-point resolution even when the same
 * `--import tsx` flag is forwarded via `execArgv` — a `new Worker(new
 * URL("./x.ts", ...))`, and even `require()`/`import()` of a `.ts` file
 * from *inside* an already-running worker, both fail with
 * `ERR_UNKNOWN_FILE_EXTENSION`. (Verified directly against this Node
 * version; not merely assumed.) Shipping the worker as a real `.js` file
 * on disk would also require teaching `tsc` to copy a non-`.ts` asset
 * into `dist/`, which means touching `tsconfig.json`'s `include`/
 * `allowJs` for a single file.
 *
 * The simplest option that works identically in dev (`tsx`) and after
 * `tsc` build, with zero build-config changes, is to keep the worker body
 * as an ordinary JS **string constant** inside a normal `.ts` module and
 * hand it to `new Worker(WORKER_SOURCE, { eval: true, ... })`. Eval-mode
 * workers run as plain CommonJS scripts (`require`/`module`/`exports`
 * available), which is exactly what we want — see run-code.ts, which
 * `require.resolve()`s the three allowlisted packages in the *parent*
 * thread (where normal TS/tsx module resolution works fine) and passes
 * their absolute paths in via `workerData`, so the worker body itself
 * never needs module resolution beyond `require(<absolute path>)`.
 *
 * Trade-off, stated honestly: the code below is unchecked by `tsc` (it's
 * just a string) and has no syntax highlighting. Keep it small and
 * boring.
 *
 * The path confinement rule is NOT duplicated here. It used to be — a
 * hand-maintained copy with a "keep the two in sync" comment — but it is
 * now interpolated from `CANVAS_PATH_GUARD_SOURCE`, which is
 * `normalizeCanvasPathStandalone.toString()` from `src/paths/index.ts`.
 * The worker therefore runs the identical function the host side
 * validates with, and the two cannot drift. That is also why this module
 * must not be minified with name mangling.
 *
 * SANDBOX SURFACE PROVIDED TO USER CODE (see also run-code.ts doc comment):
 *   - console.{log,info,warn,error}   -> captured into stdout/stderr strings
 *   - require(name)                   -> the allowlisted packages
 *                                        (apexcharts, @terrastruct/d2,
 *                                        tailwindcss), safe Node builtins
 *                                        (path, buffer, util, assert), and
 *                                        network builtins (http, https,
 *                                        net, dns, tls) — see "NETWORK
 *                                        SANDBOXING REMOVED" below
 *   - fetch, WebSocket                -> the worker thread's real globals,
 *                                        i.e. genuine outbound network
 *                                        access (see below)
 *   - fs.{readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync}
 *                                      -> confined to the session
 *                                         workspace; writes further
 *                                         confined to /src and /output
 *   - module, exports                 -> plain inert objects (CommonJS
 *                                         convention), not linked to the
 *                                         real module system
 *   - Buffer, TextEncoder/Decoder, URL, URLSearchParams, timers, Promise
 *
 * NETWORK SANDBOXING REMOVED: `fetch`/`WebSocket` globals and
 * `require("http"|"https"|"net"|"dns"|"tls")` are deliberately exposed —
 * user code can make arbitrary outbound network calls. PLAN.md section 9's
 * "no external network" default has been dropped by explicit request; see
 * project history. `XMLHttpRequest` has no Node built-in equivalent and
 * remains absent (use `fetch`).
 *
 * Everything else — `process`, `global`/`globalThis` escape hatches,
 * `require("child_process")` (shell access), `require("worker_threads")`,
 * `require("vm")`, dynamic `eval`/`new Function` (blocked at the
 * vm.Context level via `codeGeneration: { strings: false }`) — is still
 * absent from the vm context and/or rejected by the allowlist `require`.
 * These are unrelated to network access (no-shell-access /
 * no-sandbox-escape guarantees, per PLAN.md section 9) and were not part
 * of this request.
 */

import { CANVAS_PATH_GUARD_SOURCE } from "../paths/index.js";

export const WORKER_SOURCE = `
"use strict";
const { parentPort, workerData } = require("node:worker_threads");
const vm = require("node:vm");
const fsSync = require("node:fs");
const nodePath = require("node:path");
const nodeUtil = require("node:util");

const workspaceRoot = nodePath.resolve(workerData.workspaceRoot);
const allowlistPaths = workerData.allowlistPaths || {};
const timeoutMs = workerData.timeoutMs;

let stdout = "";
let stderr = "";
let resultSent = false;
let canvasCommitRequested = false;
const canvasOperations = [];
const createdNodeIds = [];

function formatArgs(args) {
  return args
    .map(function (a) {
      return typeof a === "string" ? a : nodeUtil.inspect(a, { depth: 4 });
    })
    .join(" ");
}

function sendResult(result) {
  if (resultSent) return;
  resultSent = true;
  parentPort.postMessage(Object.assign({}, result, {
    canvas: {
      commitRequested: canvasCommitRequested,
      operations: canvasOperations,
      createdNodeIds: createdNodeIds,
    },
  }));
}

function canvasOperation(operation) {
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new TypeError("canvas.operation expects an operation object");
  }
  if (typeof operation.op !== "string" || operation.op.length === 0) {
    throw new TypeError("canvas operation requires a non-empty op");
  }
  if (canvasOperations.length >= 100) {
    throw new Error("canvas operation limit exceeded (100)");
  }
  const copy = structuredClone(operation);
  canvasOperations.push(copy);
  if (copy.op === "nodes.add" && copy.value && typeof copy.value.id === "string") {
    createdNodeIds.push(copy.value.id);
  }
  return copy.value && typeof copy.value.id === "string" ? copy.value.id : copy.id;
}

function canvasAdd(collection, value) {
  return canvasOperation({ op: collection + ".add", value: value });
}

function canvasRect(value, name) {
  if (!value || typeof value !== "object") throw new TypeError(name + " requires rect");
  const rect = {
    x: Number(value.x),
    y: Number(value.y),
    w: Number(value.w !== undefined ? value.w : value.width),
    h: Number(value.h !== undefined ? value.h : value.height),
  };
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) || rect.w <= 0 || rect.h <= 0) {
    throw new TypeError(name + " requires finite x/y and positive w/h");
  }
  return rect;
}

function canvasCaption(value) {
  if (value.caption) return value.caption;
  return {
    title: String(value.title || value.id),
    ...(value.subtitle ? { subtitle: String(value.subtitle) } : {}),
    ...(value.tag ? { tag: String(value.tag) } : {}),
  };
}

function canvasImage(value) {
  const sourcePath = value.path || value.src;
  if (typeof sourcePath !== "string") throw new TypeError("canvas.image requires path or src");
  return canvasAdd("nodes", {
    id: value.id,
    kind: "image",
    rect: canvasRect(value.rect || value, "canvas.image"),
    caption: canvasCaption(value),
    anchors: value.anchors || [],
    source: { path: sourcePath },
    fit: value.fit || "contain",
    focalPosition: value.focalPosition || { x: 0.5, y: 0.5 },
    alt: String(value.alt || value.title || value.id),
    ...(value.stageId ? { stageId: value.stageId } : {}),
    ...(value.laneId ? { laneId: value.laneId } : {}),
  });
}

function canvasText(value) {
  return canvasAdd("labels", {
    id: value.id,
    text: String(value.text),
    rect: canvasRect(value.rect || value, "canvas.text"),
    ...(value.tone ? { tone: value.tone } : {}),
    ...(value.align ? { align: value.align } : {}),
  });
}

function canvasNative(value, defaultShape) {
  return canvasAdd("nodes", {
    id: value.id,
    kind: "native",
    shape: value.shape || defaultShape || "card",
    rect: canvasRect(value.rect || value, "canvas.native"),
    caption: canvasCaption(value),
    anchors: value.anchors || [],
    ...(value.body ? { body: value.body } : {}),
    ...(value.stageId ? { stageId: value.stageId } : {}),
    ...(value.laneId ? { laneId: value.laneId } : {}),
  });
}

function canvasSticky(value) {
  if (!value || typeof value !== "object") throw new TypeError("canvas.sticky requires a note");
  const x = Number(value.x);
  const y = Number(value.y);
  const w = Number(value.w !== undefined ? value.w : value.width !== undefined ? value.width : 240);
  if (![x, y, w].every(Number.isFinite) || w <= 0) {
    throw new TypeError("canvas.sticky requires finite x/y and a positive w");
  }
  const text = String(value.text === undefined ? "" : value.text);
  if (!text.trim()) throw new TypeError("canvas.sticky requires text");
  // No author: the server stamps every note this SDK commits as the agent's.
  return canvasAdd("notes", {
    id: value.id || "note-" + (canvasOperations.length + 1),
    x: x,
    y: y,
    w: w,
    text: text,
    ...(value.color ? { color: value.color } : {}),
    ...(value.size ? { size: value.size } : {}),
  });
}

function canvasFrame(value) {
  return canvasAdd("stages", {
    id: value.id,
    index: Number.isInteger(value.index) ? value.index : 0,
    label: String(value.label || value.title || value.id),
    ...(value.summary ? { summary: String(value.summary) } : {}),
    rect: canvasRect(value.rect || value, "canvas.frame"),
  });
}

function canvasDrawing(kind, value) {
  const style = Object.assign(
    { preset: value.preset || "info", strokeWidth: value.strokeWidth || 4 },
    value.style || {},
  );
  const drawing = { id: value.id, kind: kind, style: style };
  if (value.label) drawing.label = String(value.label);
  if (["rect", "ellipse", "highlight"].includes(kind)) drawing.bounds = value.bounds;
  else if (kind === "line" || kind === "arrow") {
    drawing.from = value.from;
    drawing.to = value.to;
  } else if (kind === "path") {
    drawing.points = value.points;
    drawing.closed = value.closed === true;
  } else {
    drawing.at = value.at;
    drawing.text = String(value.text);
    if (kind === "callout" && value.number !== undefined) drawing.number = value.number;
  }
  return canvasAdd("drawings", drawing);
}

function canvasPoint(nodeId, x, y) {
  return { type: "node", nodeId: nodeId, x: x, y: y };
}

function canvasAnchor(nodeId, side, offset) {
  return { type: "anchor", nodeId: nodeId, side: side, offset: offset === undefined ? 0.5 : offset };
}

function canvasWorldPoint(x, y) {
  return { type: "point", x: x, y: y };
}

function canvasNodeBounds(nodeId, x, y, w, h, clip) {
  return { type: "node", nodeId: nodeId, x: x, y: y, w: w, h: h, clip: clip !== false };
}

function canvasWorldBounds(x, y, w, h) {
  return { type: "rect", x: x, y: y, w: w, h: h };
}

function layoutStack(value) {
  let y = Number(value.y || 0);
  const gap = Number(value.gap || 0);
  return (value.items || []).map(function (item) {
    const h = Number(item.h !== undefined ? item.h : item.height);
    const rect = { x: Number(value.x || 0), y: y, w: Number(item.w || value.w || value.width), h: h };
    y += h + gap;
    return { id: item.id, rect: rect };
  });
}

function layoutRow(value) {
  let x = Number(value.x || 0);
  const gap = Number(value.gap || 0);
  return (value.items || []).map(function (item) {
    const w = Number(item.w !== undefined ? item.w : item.width);
    const rect = { x: x, y: Number(value.y || 0), w: w, h: Number(item.h || value.h || value.height) };
    x += w + gap;
    return { id: item.id, rect: rect };
  });
}

function layoutGrid(value) {
  const items = value.items || [];
  const columns = Math.max(1, Number(value.columns || 2));
  const gap = Number(value.gap || 0);
  const width = Number(value.w || value.width);
  const cellWidth = (width - gap * (columns - 1)) / columns;
  const rowHeight = Number(value.rowHeight || value.h || value.height);
  return items.map(function (item, index) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      id: item.id,
      rect: {
        x: Number(value.x || 0) + column * (cellWidth + gap),
        y: Number(value.y || 0) + row * (rowHeight + gap),
        w: cellWidth,
        h: Number(item.h || rowHeight),
      },
    };
  });
}

function annotatedScreenshot(value) {
  canvasImage(value);
  (value.annotations || []).forEach(function (annotation, index) {
    const kind = annotation.kind || annotation.type;
    const id = annotation.id || value.id + "-annotation-" + (index + 1);
    const shared = Object.assign({}, annotation, { id: id });
    if (["rect", "ellipse", "highlight"].includes(kind) && !shared.bounds) {
      const bounds = annotation.rect || annotation;
      shared.bounds = canvasNodeBounds(value.id, bounds.x, bounds.y, bounds.w || bounds.width, bounds.h || bounds.height);
    }
    if ((kind === "badge" || kind === "callout") && !shared.at) {
      shared.at = canvasPoint(value.id, annotation.x, annotation.y);
    }
    canvasDrawing(kind, shared);
  });
  return value.id;
}

function beforeAfter(value) {
  const rect = canvasRect(value.rect || value, "canvas.composition.beforeAfter");
  const gap = Number(value.gap || 32);
  const cellWidth = (rect.w - gap) / 2;
  const before = Object.assign({}, value.before, {
    id: value.before.id || value.id + "-before",
    rect: { x: rect.x, y: rect.y, w: cellWidth, h: rect.h },
    stageId: value.id,
  });
  const after = Object.assign({}, value.after, {
    id: value.after.id || value.id + "-after",
    rect: { x: rect.x + cellWidth + gap, y: rect.y, w: cellWidth, h: rect.h },
    stageId: value.id,
  });
  canvasFrame({ id: value.id, index: value.index || 0, label: value.title || value.id, rect: rect });
  annotatedScreenshot(before);
  annotatedScreenshot(after);
  canvasAdd("groups", { id: value.id + "-group", label: value.title || value.id, nodeIds: [before.id, after.id] });
  return { stageId: value.id, groupId: value.id + "-group", beforeId: before.id, afterId: after.id };
}

function numberedCallouts(value) {
  return (value.items || []).map(function (item, index) {
    return canvasDrawing("callout", {
      id: item.id || value.target + "-callout-" + (index + 1),
      at: item.at || canvasPoint(value.target, item.x, item.y),
      text: item.text,
      number: item.number || index + 1,
      preset: item.preset || value.preset || "info",
    });
  });
}

function specTable(value) {
  const columns = value.columns || [];
  const rows = value.rows || [];
  return canvasNative({
    id: value.id,
    title: value.title || "Specification",
    rect: value.rect || value,
    shape: "screen",
    stageId: value.stageId,
    body: {
      code: [columns.join(" | ")].concat(rows.map(function (row) { return row.join(" | "); })).join("\\n"),
    },
  }, "screen");
}

function acceptanceChecklist(value) {
  return canvasNative({
    id: value.id,
    title: value.title || "Acceptance criteria",
    rect: value.rect || value,
    shape: "card",
    stageId: value.stageId,
    body: { points: (value.items || []).map(function (item) { return "✓ " + item; }) },
  }, "card");
}

function issueSection(value) {
  const rect = canvasRect(value.rect || value, "canvas.composition.issueSection");
  const padding = Number(value.padding || 32);
  const checklistWidth = value.acceptance && value.acceptance.length > 0
    ? Math.min(360, Math.max(260, rect.w * 0.28))
    : 0;
  const gap = checklistWidth > 0 ? Number(value.gap || 28) : 0;
  const screenshot = Object.assign({}, value.screenshot, {
    id: value.screenshot.id || value.id + "-screenshot",
    rect: value.screenshot.rect || {
      x: rect.x + padding,
      y: rect.y + padding,
      w: rect.w - padding * 2 - checklistWidth - gap,
      h: rect.h - padding * 2,
    },
    stageId: value.id,
    annotations: value.annotations || value.screenshot.annotations || [],
  });
  canvasFrame({ id: value.id, index: value.index || 0, label: value.title || value.id, rect: rect });
  annotatedScreenshot(screenshot);
  const nodeIds = [screenshot.id];
  let checklistId;
  if (checklistWidth > 0) {
    checklistId = value.id + "-acceptance";
    acceptanceChecklist({
      id: checklistId,
      title: value.acceptanceTitle || "Acceptance criteria",
      items: value.acceptance,
      stageId: value.id,
      rect: {
        x: rect.x + rect.w - padding - checklistWidth,
        y: rect.y + padding,
        w: checklistWidth,
        h: rect.h - padding * 2,
      },
    });
    nodeIds.push(checklistId);
  }
  const groupId = value.groupId || value.id + "-group";
  canvasAdd("groups", { id: groupId, label: value.title || value.id, nodeIds: nodeIds });
  return { stageId: value.id, groupId: groupId, screenshotId: screenshot.id, checklistId: checklistId };
}

function stepFlow(value) {
  const placements = layoutRow({
    x: value.x,
    y: value.y,
    h: value.h || 140,
    gap: value.gap || 48,
    items: (value.steps || []).map(function (step) { return { id: step.id, w: step.w || value.stepWidth || 220 }; }),
  });
  (value.steps || []).forEach(function (step, index) {
    canvasNative({
      id: step.id,
      title: step.title,
      rect: placements[index].rect,
      shape: step.shape || "screen",
      body: step.body,
      anchors: [{ id: "left", side: "left", offset: 0.5 }, { id: "right", side: "right", offset: 0.5 }],
    }, "screen");
    if (index > 0) {
      canvasAdd("edges", {
        id: value.id + "-edge-" + index,
        source: { nodeId: value.steps[index - 1].id },
        target: { nodeId: step.id },
        kind: "main",
        route: { type: "straight" },
      });
    }
  });
  return placements;
}

const canvasLayout = Object.freeze({
  stack: layoutStack,
  row: layoutRow,
  grid: layoutGrid,
  columns: layoutGrid,
  overlay: function (value) { return (value.items || []).map(function (item) { return { id: item.id, rect: canvasRect(value.rect || value, "canvas.layout.overlay") }; }); },
  inset: function (rect, padding) { const value = canvasRect(rect, "canvas.layout.inset"); return { x: value.x + padding, y: value.y + padding, w: value.w - padding * 2, h: value.h - padding * 2 }; },
});

const canvasComposition = Object.freeze({
  annotatedScreenshot: annotatedScreenshot,
  beforeAfter: beforeAfter,
  comparison: beforeAfter,
  numberedCallouts: numberedCallouts,
  issueSection: issueSection,
  specTable: specTable,
  acceptanceChecklist: acceptanceChecklist,
  stepFlow: stepFlow,
});

const canvasNodeApi = Object.assign(
  function (value) { return canvasAdd("nodes", value); },
  { native: function (value) { return canvasNative(value, "card"); }, card: function (value) { return canvasNative(value, "card"); }, image: canvasImage, text: canvasText, frame: canvasFrame },
);
const canvasDrawingApi = Object.assign(
  function (value) { return canvasAdd("drawings", value); },
  {
    rect: function (value) { return canvasDrawing("rect", value); },
    ellipse: function (value) { return canvasDrawing("ellipse", value); },
    line: function (value) { return canvasDrawing("line", value); },
    arrow: function (value) { return canvasDrawing("arrow", value); },
    path: function (value) { return canvasDrawing("path", value); },
    highlight: function (value) { return canvasDrawing("highlight", value); },
    badge: function (value) { return canvasDrawing("badge", value); },
    callout: function (value) { return canvasDrawing("callout", value); },
  },
);

const canvasSdk = Object.freeze({
  operation: canvasOperation,
  world: function (changes) { return canvasOperation({ op: "world.update", changes: changes }); },
  node: Object.freeze(canvasNodeApi),
  native: function (value) { return canvasNative(value, "card"); },
  card: function (value) { return canvasNative(value, "card"); },
  image: canvasImage,
  text: canvasText,
  frame: canvasFrame,
  sticky: canvasSticky,
  stage: function (value) { return canvasAdd("stages", value); },
  label: function (value) { return canvasAdd("labels", value); },
  group: function (value) { return canvasAdd("groups", value); },
  edge: function (value) { return canvasAdd("edges", Object.assign({ kind: "main", route: { type: "orthogonal" } }, value)); },
  drawing: Object.freeze(canvasDrawingApi),
  rect: function (value) { return canvasDrawing("rect", value); },
  ellipse: function (value) { return canvasDrawing("ellipse", value); },
  line: function (value) { return canvasDrawing("line", value); },
  arrow: function (value) { return canvasDrawing("arrow", value); },
  path: function (value) { return canvasDrawing("path", value); },
  highlight: function (value) { return canvasDrawing("highlight", value); },
  badge: function (value) { return canvasDrawing("badge", value); },
  callout: function (value) { return canvasDrawing("callout", value); },
  point: canvasPoint,
  anchor: canvasAnchor,
  worldPoint: canvasWorldPoint,
  bounds: canvasNodeBounds,
  worldBounds: canvasWorldBounds,
  layout: canvasLayout,
  composition: canvasComposition,
  commit: function () {
    if (canvasOperations.length === 0) throw new Error("canvas.commit requires at least one operation");
    canvasCommitRequested = true;
  },
});

// Injected verbatim from src/paths/index.ts — literally the same function
// object the host side validates with, stringified. Not a copy; see this
// file's header comment and that module's.
${CANVAS_PATH_GUARD_SOURCE}

function resolveInWorkspace(requestedPath, mode) {
  var normalized = normalizeCanvasPathStandalone(requestedPath, mode);
  return nodePath.resolve(workspaceRoot, normalized.relPath);
}

const scopedFs = {
  readFileSync: function (p, opts) {
    return fsSync.readFileSync(resolveInWorkspace(p, "read"), opts || "utf8");
  },
  writeFileSync: function (p, data) {
    const abs = resolveInWorkspace(p, "write");
    fsSync.mkdirSync(nodePath.dirname(abs), { recursive: true });
    fsSync.writeFileSync(abs, data);
  },
  mkdirSync: function (p, opts) {
    return fsSync.mkdirSync(resolveInWorkspace(p, "write"), opts || { recursive: true });
  },
  readdirSync: function (p) {
    return fsSync.readdirSync(resolveInWorkspace(p, "read"));
  },
  existsSync: function (p) {
    try {
      return fsSync.existsSync(resolveInWorkspace(p, "read"));
    } catch (err) {
      return false;
    }
  },
};

const SAFE_BUILTINS = {
  path: nodePath,
  "node:path": nodePath,
  buffer: require("node:buffer"),
  "node:buffer": require("node:buffer"),
  assert: require("node:assert"),
  "node:assert": require("node:assert"),
  util: { inspect: nodeUtil.inspect, format: nodeUtil.format },
  "node:util": { inspect: nodeUtil.inspect, format: nodeUtil.format },
  // Network sandboxing removed by explicit request — see this file's header.
  http: require("node:http"),
  "node:http": require("node:http"),
  https: require("node:https"),
  "node:https": require("node:https"),
  net: require("node:net"),
  "node:net": require("node:net"),
  dns: require("node:dns"),
  "node:dns": require("node:dns"),
  tls: require("node:tls"),
  "node:tls": require("node:tls"),
};

function sandboxedRequire(name) {
  if (Object.prototype.hasOwnProperty.call(allowlistPaths, name)) {
    return require(allowlistPaths[name]);
  }
  if (Object.prototype.hasOwnProperty.call(SAFE_BUILTINS, name)) {
    return SAFE_BUILTINS[name];
  }
  throw new Error("Module not allowed in sandbox: " + name);
}

const sandboxConsole = {
  log: function () { stdout += formatArgs(Array.prototype.slice.call(arguments)) + "\\n"; },
  info: function () { stdout += formatArgs(Array.prototype.slice.call(arguments)) + "\\n"; },
  debug: function () { stdout += formatArgs(Array.prototype.slice.call(arguments)) + "\\n"; },
  warn: function () { stderr += formatArgs(Array.prototype.slice.call(arguments)) + "\\n"; },
  error: function () { stderr += formatArgs(Array.prototype.slice.call(arguments)) + "\\n"; },
};

const sandboxModule = { exports: {} };
const sandboxGlobal = {
  console: sandboxConsole,
  require: sandboxedRequire,
  fs: scopedFs,
  module: sandboxModule,
  exports: sandboxModule.exports,
  __dirname: workspaceRoot,
  __filename: nodePath.join(workspaceRoot, "src", "sandbox-entry.js"),
  Buffer: Buffer,
  TextEncoder: TextEncoder,
  TextDecoder: TextDecoder,
  URL: URL,
  URLSearchParams: URLSearchParams,
  Promise: Promise,
  canvas: canvasSdk,
  structuredClone: structuredClone,
  // Network sandboxing removed by explicit request — see this file's header.
  fetch: fetch,
  WebSocket: WebSocket,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  queueMicrotask: queueMicrotask,
};

const context = vm.createContext(sandboxGlobal, {
  codeGeneration: { strings: false, wasm: false },
});

process.on("uncaughtException", function (err) {
  sendResult({
    success: false,
    stdout: stdout,
    stderr: stderr,
    error: "Uncaught exception: " + (err && err.stack ? err.stack : String(err)),
  });
});
process.on("unhandledRejection", function (reason) {
  sendResult({
    success: false,
    stdout: stdout,
    stderr: stderr,
    error: "Unhandled rejection: " + (reason && reason.stack ? reason.stack : String(reason)),
  });
});

try {
  const script = new vm.Script(workerData.code, { filename: "sandbox.js" });
  const completionValue = script.runInContext(context, {
    timeout: timeoutMs,
    breakOnSigint: false,
  });
  Promise.resolve(completionValue)
    .then(function () {
      sendResult({ success: true, stdout: stdout, stderr: stderr });
    })
    .catch(function (err) {
      sendResult({
        success: false,
        stdout: stdout,
        stderr: stderr,
        error: err && err.stack ? err.stack : String(err),
      });
    });
} catch (err) {
  sendResult({
    success: false,
    stdout: stdout,
    stderr: stderr,
    error: err && err.stack ? err.stack : String(err),
  });
}
`;
