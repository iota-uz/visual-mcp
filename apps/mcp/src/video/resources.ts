import { createHash } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/server";
import { JobRequest } from "@visual-canvas/video/jobs";
import { componentResources, effectResources } from "@visual-canvas/video/registry";
import { z } from "zod";
import { openCursor, sealCursor } from "./cursor.js";
import type { Definition, DomainResource, VideoBackend } from "./registry.js";
import { VideoDomainError } from "./registry.js";

const id = z.string().min(1).max(1000),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const kind = (uri: string) =>
  uri.startsWith("video://reports/")
    ? "report"
    : uri.startsWith("video://components/")
      ? "component"
      : uri.startsWith("video://presets/")
        ? "preset"
        : uri.startsWith("video://models/")
          ? "model"
          : uri.includes("/templates")
            ? "template"
            : uri.includes("/themes")
              ? "theme"
              : "guide";
const summary = z
  .object({
    uri: id,
    name: z.string(),
    summary: z.string(),
    kind: z.enum(["model", "template", "theme", "guide", "component", "preset", "report"]),
  })
  .strict();
function decode(cursor: unknown) {
  try {
    return z
      .object({ key: hash, offset: z.number().int().nonnegative(), expires: z.number() })
      .strict()
      .parse(openCursor(String(cursor)));
  } catch {
    throw new VideoDomainError(
      "CURSOR_MISMATCH",
      "Invalid resource cursor; restart without cursor.",
    );
  }
}
function offset(cursor: unknown, key: string) {
  if (!cursor) return 0;
  const value = decode(cursor);
  if (value.key !== key || value.expires < Date.now())
    throw new VideoDomainError(
      "CURSOR_MISMATCH",
      "Resource content or filters changed; restart without cursor.",
    );
  return value.offset;
}
const next = (key: string, offset: number) =>
  sealCursor({ key, offset, expires: Date.now() + 3600000 });

const reportCache = new Map<string, { text: string; expires: number }>();
async function critiqueResource(
  uri: string,
  call: VideoBackend,
): Promise<DomainResource | undefined> {
  const match = /^video:\/\/reports\/([^/]+)\/([a-f0-9]{64})$/.exec(uri);
  if (!match) return undefined;
  const job = z
    .object({
      workspaceId: z.string(),
      result: z.object({
        kind: z.literal("critique"),
        report: z.object({ assetId: z.string(), revisionId: z.string() }),
        reportSha256: hash,
      }),
    })
    .parse(await call("getJob", { jobId: decodeURIComponent(match[1] ?? "") }));
  if (job.result.reportSha256 !== match[2])
    throw new VideoDomainError(
      "RESOURCE_CHANGED",
      "Job report differs from exact requested hash; inspect job_get.",
    );
  return {
    uri,
    name: "Immutable full critique report",
    description: "All findings, criteria and limitations; no summary truncation.",
    mimeType: "application/json",
    read: async () => {
      const signed = z
        .object({
          url: z.url(),
          sha256: hash,
          sizeBytes: z
            .number()
            .int()
            .positive()
            .max(16 * 1024 * 1024),
        })
        .parse(
          await call("inspectAsset", { workspaceId: job.workspaceId, asset: job.result.report }),
        );
      if (signed.sha256 !== job.result.reportSha256)
        throw new VideoDomainError(
          "RESOURCE_CHANGED",
          "Registered report hash differs from original critique receipt.",
        );
      for (const [key, cached] of reportCache)
        if (cached.expires < Date.now()) reportCache.delete(key);
      const cached = reportCache.get(uri);
      if (cached) return { contents: [{ uri, mimeType: "application/json", text: cached.text }] };
      const response = await fetch(signed.url, {
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok || !response.body)
        throw new VideoDomainError(
          "RESOURCE_UNAVAILABLE",
          "Report bytes unavailable; retry this exact URI.",
        );
      const reader = response.body.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > signed.sizeBytes || size > 16 * 1024 * 1024)
            throw new VideoDomainError(
              "RESOURCE_TOO_LARGE",
              "Report exceeds registered byte bound; inspect original receipt.",
            );
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel();
      }
      const bytes = Buffer.concat(chunks);
      if (
        size !== signed.sizeBytes ||
        createHash("sha256").update(bytes).digest("hex") !== signed.sha256
      )
        throw new VideoDomainError(
          "RESOURCE_CHANGED",
          "Report bytes fail original size/hash verification.",
        );
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      JSON.parse(text);
      while (reportCache.size >= 2) {
        const oldest = reportCache.keys().next().value;
        if (!oldest) break;
        reportCache.delete(oldest);
      }
      reportCache.set(uri, { text, expires: Date.now() + 300000 });
      return { contents: [{ uri, mimeType: "application/json", text }] };
    },
  };
}
export function registerDomainResources(
  server: McpServer,
  call: VideoBackend,
  resources: DomainResource[],
) {
  for (const item of [...componentResources, ...effectResources]) {
    const uri = `video://${item.kind === "component" ? "components" : "presets"}/${encodeURIComponent(item.resourceId)}/${item.revisionId}`;
    const resource: DomainResource = {
      uri,
      name: item.resourceId,
      description: item.description,
      mimeType: "application/json",
      read: async () => ({
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(item) }],
      }),
    };
    resources.push(resource);
    server.registerResource(
      item.resourceId,
      uri,
      { title: resource.name, description: resource.description, mimeType: resource.mimeType },
      async () => ({
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(item) }],
      }),
    );
  }
  for (const family of ["image", "voice", "shot", "critique", "render"]) {
    const uri = `video://models/${family}`;
    const resource: DomainResource = {
      uri,
      name: `${family} server capability`,
      description:
        "Actual configured provider family and implemented request schema. Configured is not account-verified availability or quality.",
      mimeType: "application/json",
      read: async () => {
        const capabilities = z
          .record(z.string(), z.unknown())
          .parse(await call("getCapabilities", {}));
        const request = JobRequest.options.find((option) => option.shape.kind.value === family);
        if (!request) throw new Error("Model schema unavailable");
        return {
          contents: [
            {
              uri,
              mimeType: "application/json",
              text: JSON.stringify({
                family,
                availability: "account_not_verified",
                configuration: capabilities[family],
                settingsSchema: z.toJSONSchema(request, { io: "input" }),
                limitations: [
                  "Presence of a server credential does not prove model entitlement, provider health or language quality.",
                ],
              }),
            },
          ],
        };
      },
    };
    resources.push(resource);
    server.registerResource(
      `video-model-${family}`,
      uri,
      { title: resource.name, description: resource.description, mimeType: resource.mimeType },
      async () => ({
        contents: z
          .array(z.object({ uri: z.string(), mimeType: z.string(), text: z.string() }))
          .parse((await resource.read()).contents),
      }),
    );
  }
  call.resources = resources;
}
export const resourceDefinitions: Definition[] = [
  {
    name: "resource_find",
    description:
      "List/filter existing domain resources: model capabilities, templates, themes and guides. This is not tool search and never returns a tool registry. Read chosen URI with resource_get or native resources/read. Results are compact metadata, not full documents.",
    readOnly: true,
    input: z
      .object({
        kind: summary.shape.kind.optional(),
        query: z.string().max(200).optional(),
        cursor: z.string().max(2000).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
      .strict(),
    output: z
      .object({
        items: z.array(summary),
        complete: z.boolean(),
        next_cursor: z.string().nullable(),
      })
      .strict(),
    run: async (input, call) => {
      const rows = (call.resources ?? [])
        .map((resource) => ({
          uri: resource.uri,
          name: resource.name,
          summary: resource.description,
          kind: kind(resource.uri),
        }))
        .filter(
          (row) =>
            (!input.kind || input.kind === row.kind) &&
            (!input.query ||
              `${row.name} ${row.summary} ${row.uri}`
                .toLowerCase()
                .includes(String(input.query).toLowerCase())),
        );
      const key = digest(JSON.stringify([rows, input.kind, input.query, input.limit]));
      const start = offset(input.cursor, key),
        end = start + Number(input.limit);
      return {
        items: rows.slice(start, end),
        complete: end >= rows.length,
        next_cursor: end >= rows.length ? null : next(key, end),
      };
    },
  },
  {
    name: "resource_get",
    description:
      "Read one registered domain resource URI, or video://reports/{job_id}/{reportSha256} from an authorized critique job_get receipt for full findings/criteria. Never fetches caller-supplied URLs. Pin sha256; byte-bounded cursors bind exact content hash. Concatenate content chunks before JSON parsing.",
    readOnly: true,
    input: z
      .object({
        uri: id,
        sha256: hash.optional(),
        cursor: z.string().max(2000).optional(),
        max_bytes: z.number().int().min(2048).max(131072).default(32768),
      })
      .strict(),
    output: z
      .object({
        uri: id,
        kind: summary.shape.kind,
        mime_type: z.string(),
        sha256: hash,
        content: z.string(),
        complete: z.boolean(),
        next_cursor: z.string().nullable(),
      })
      .strict(),
    run: async (input, call) => {
      const resource =
        call.resources?.find((resource) => resource.uri === input.uri) ??
        (await critiqueResource(String(input.uri), call));
      if (!resource)
        throw new VideoDomainError(
          "RESOURCE_NOT_FOUND",
          "Select a URI returned by resource_find; arbitrary URLs are not fetched.",
        );
      const value = await resource.read();
      const contents = z.array(z.object({ text: z.string() })).parse(value.contents);
      const content = contents.map((item) => item.text).join("\n"),
        bytes = Buffer.from(content),
        sha = digest(content);
      if (input.sha256 && input.sha256 !== sha)
        throw new VideoDomainError(
          "RESOURCE_CHANGED",
          "Resource hash changed; read current content before choosing settings.",
        );
      const key = digest(JSON.stringify([input.uri, sha, input.max_bytes]));
      const start = offset(input.cursor, key);
      let end = Math.min(bytes.length, start + Math.floor((Number(input.max_bytes) - 1024) / 6));
      while (end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end--;
      return {
        uri: input.uri,
        kind: kind(resource.uri),
        mime_type: resource.mimeType,
        sha256: sha,
        content: bytes.subarray(start, end).toString("utf8"),
        complete: end >= bytes.length,
        next_cursor: end >= bytes.length ? null : next(key, end),
      };
    },
  },
];
