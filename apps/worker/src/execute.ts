import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCode } from "@visual-canvas/runtime/sandbox/run-code.js";
import type { Hono, MiddlewareHandler } from "hono";
import { z } from "zod";

export const ExecuteRequest = z
  .object({
    code: z
      .string()
      .min(1)
      .refine((v) => Buffer.byteLength(v) <= 65536, "Code exceeds 65536 UTF-8 bytes"),
    inputs: z.record(z.unknown()).default({}),
    context: z.object({ workspace_id: z.string().min(1), run_id: z.string().min(1) }).strict(),
    toolNames: z.array(z.string().min(1).max(128)).max(200),
    timeoutMs: z.number().int().min(1).max(60000).default(5000),
    memoryLimitMb: z.number().int().min(16).max(1024).default(128),
    maxToolCalls: z.number().int().min(1).max(100).default(30),
    maxConcurrency: z.number().int().min(1).max(4).default(1),
    maxOutputBytes: z.number().int().min(256).max(131072).default(32768),
    callback: z.object({ url: z.string().url(), token: z.string().min(32).max(256) }).strict(),
  })
  .strict();

export function validateCallback(
  url: string,
  configuredOrigin = process.env.MCP_EXECUTE_BROKER_ORIGIN,
) {
  if (!configuredOrigin) throw new Error("Execute broker origin is not configured");
  const parsed = new URL(url);
  if (
    parsed.origin !== new URL(configuredOrigin).origin ||
    parsed.pathname !== "/internal/video-execute-broker" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Execute callback is outside the configured broker endpoint");
  }
  return parsed;
}

export async function handleExecute(
  input: z.infer<typeof ExecuteRequest>,
  signal?: AbortSignal,
  fetchImpl = fetch,
) {
  const callbackUrl = validateCallback(input.callback.url);
  if (Buffer.byteLength(JSON.stringify(input.inputs)) > 262144)
    throw new Error("Inputs exceed 262144 UTF-8 bytes");
  const workspace = await mkdtemp(join(tmpdir(), "visual-execute-"));
  try {
    await Promise.all(
      ["src", "output", "assets", "cache", "templates"].map((path) => mkdir(join(workspace, path))),
    );
    return await runCode(
      { session_id: input.context.run_id, workspace, created_at: new Date().toISOString() },
      input.code,
      {
        signal,
        timeoutMs: input.timeoutMs,
        memoryLimitMb: input.memoryLimitMb,
        broker: {
          toolNames: input.toolNames,
          inputs: input.inputs,
          context: input.context,
          maxToolCalls: input.maxToolCalls,
          maxConcurrency: input.maxConcurrency,
          maxOutputBytes: input.maxOutputBytes,
          call: async (name, args, callId) => {
            // The capability and callback address stay in this trusted parent;
            // runCode passes only data/tool names into the worker isolate.
            const response = await fetchImpl(callbackUrl, {
              method: "POST",
              redirect: "error",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${input.callback.token}`,
              },
              body: JSON.stringify({ runId: input.context.run_id, callId, name, args }),
              signal: AbortSignal.timeout(65000),
            });
            if (!response.ok) throw new Error("Execute broker rejected the callback");
            const length = response.headers.get("content-length");
            if (length && Number(length) > 1048576)
              throw new Error("Execute broker response too large");
            // Read a bounded stream: Content-Length is not authoritative.
            const reader = response.body?.getReader();
            if (!reader) throw new Error("Execute broker returned no result");
            let bytes = 0;
            const chunks: Uint8Array[] = [];
            try {
              while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                bytes += chunk.value.byteLength;
                if (bytes > 1048576) throw new Error("Execute broker response too large");
                chunks.push(chunk.value);
              }
            } finally {
              await reader.cancel();
            }
            return JSON.parse(Buffer.concat(chunks).toString("utf8"));
          },
        },
      },
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

export function registerExecuteRoute(app: Hono, requireWorkerToken: MiddlewareHandler) {
  app.use("/execute", requireWorkerToken);
  app.post("/execute", async (c) => {
    const parsed = ExecuteRequest.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Invalid execute request" }, 400);
    try {
      return c.json(await handleExecute(parsed.data, c.req.raw.signal));
    } catch {
      return c.json(
        { error: "Execute worker failed; inspect the existing run. No automatic rerun." },
        500,
      );
    }
  });
}
