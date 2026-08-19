import { readFile } from "node:fs/promises";
import path from "node:path";
import { addParticipantActors } from "../examples/osago-24/participant-actors.mjs";

const endpoint = process.env.VISUAL_CANVAS_MCP_URL || "https://giddy-retriever-468.convex.site/mcp";
const token = process.env.VISUAL_CANVAS_MCP_TOKEN;
if (!token) throw new Error("VISUAL_CANVAS_MCP_TOKEN is required");
const updateExisting = process.argv.includes("--update");
let id = 0;
async function call(name, args) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: ++id,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const raw = await response.text();
  const line = raw.split("\n").find((value) => value.startsWith("data: "));
  const envelope = JSON.parse(line ? line.slice(6) : raw);
  if (envelope.error) throw new Error(`${name}: ${JSON.stringify(envelope.error)}`);
  const result = envelope.result;
  if (result?.isError) throw new Error(`${name}: ${result.content?.[0]?.text || "tool failed"}`);
  return result.structuredContent || JSON.parse(result.content?.[0]?.text || "{}");
}
if (process.argv.includes("--render-only")) {
  const rendered = await call("canvas_save", {
    ref: "osago/fast-settlement-v2",
    mode: "update",
    renders: [
      { target: { type: "canvas" }, format: "png", output_path: "/output/osago-24.png" },
      { target: { type: "canvas" }, format: "pdf", output_path: "/output/osago-24.pdf" },
    ],
  });
  console.log(
    JSON.stringify({
      status: rendered.status,
      canvas_id: rendered.canvas_id,
      canvas_url: rendered.canvas_url,
      share_url: rendered.share_url,
      version: rendered.version,
      renders: rendered.renders,
      warnings: rendered.warnings,
    }),
  );
  process.exit(0);
}
const root = path.resolve("examples/osago-24");
const assets = [
  "accident-1.jpg",
  "accident-2.jpg",
  "accident-3.jpg",
  "eai-logo.svg",
  "granite-logo.svg",
  "myid-face-camera-v1.png",
  "myid-logo.jpg",
  "qr-invite.svg",
];
const fonts = [
  "Manrope-wght.ttf",
  "Unbounded-wght.ttf",
  "IBMPlexMono-Regular.ttf",
  "IBMPlexMono-Medium.ttf",
  "IBMPlexMono-SemiBold.ttf",
];
const uploadIds = {};
for (const name of [...assets, ...fonts]) {
  const isFont = fonts.includes(name);
  const relPath = isFont ? `/assets/fonts/${name}` : `/assets/${name}`;
  const ticket = await call("canvas_upload_url", {
    ref: "osago/fast-settlement-v2",
    path: relPath,
  });
  const body = await readFile(path.join(root, "assets", ...(isFont ? ["fonts", name] : [name])));
  const response = await fetch(ticket.upload_url, {
    method: "POST",
    headers: {
      "content-type": isFont
        ? "font/ttf"
        : name.endsWith(".svg")
        ? "image/svg+xml"
        : name.endsWith(".png")
          ? "image/png"
          : "image/jpeg",
    },
    body,
  });
  if (!response.ok) throw new Error(`upload ${name}: HTTP ${response.status}`);
  uploadIds[name] = (await response.json()).storageId;
}
if (!updateExisting)
  await call("canvas_delete", { ref: "osago/fast-settlement-v2", target: "canvas", purge: true });
const doc = addParticipantActors(JSON.parse(await readFile(path.join(root, "canvas.json"), "utf8")));
const screenNames = [
  "runtime.html",
  "runtime.css",
  "runtime.js",
  "reference-templates.js",
];
const files = [];
for (const name of screenNames)
  files.push({
    path: `/src/screens/${name}`,
    text: await readFile(path.join(root, "src", "screens", name), "utf8"),
  });
for (const name of assets) files.push({ path: `/assets/${name}`, upload_id: uploadIds[name] });
for (const name of fonts)
  files.push({ path: `/assets/fonts/${name}`, upload_id: uploadIds[name] });
const saved = await call("canvas_save", {
  ref: "osago/fast-settlement-v2",
  ...(updateExisting ? { mode: "update" } : {}),
  title: "OSAGO Fast Settlement",
  description:
    "OSAGO 24 fast settlement: native service blueprint with 32 interactive product screens.",
  kind: "canvas",
  doc,
  files,
  renders: [
    { target: { type: "canvas" }, format: "png", output_path: "/output/osago-24.png" },
    { target: { type: "canvas" }, format: "pdf", output_path: "/output/osago-24.pdf" },
  ],
  visibility: "public",
  note: "Pixel-perfect iframe screens extracted from the authoritative OSAGO index.html",
});
console.log(
  JSON.stringify({
    status: saved.status,
    canvas_id: saved.canvas_id,
    canvas_url: saved.canvas_url,
    share_url: saved.share_url,
    version: saved.version,
    renders: saved.renders,
    warnings: saved.warnings,
  }),
);
