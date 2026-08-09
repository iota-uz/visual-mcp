import { randomUUID } from "node:crypto";
import { runCode } from "@visual-canvas/runtime/sandbox/run-code.js";
import { collectOutputs, hydrate } from "@visual-canvas/runtime/storage/workspace.js";
import type { Session } from "@visual-canvas/runtime/types.js";
import type { ExecRequest } from "./schemas.js";
import { uploadFile } from "./upload.js";

export interface ExecArtifactResult {
  relPath: string;
  size: number;
  uploaded: boolean;
  uploadStatus?: number;
  uploadBody?: unknown;
}

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  artifacts: ExecArtifactResult[];
}

/**
 * Runs untrusted code against a throwaway hydrated workspace and uploads
 * whatever it produced. `req.uploads` is an anonymous pool, not pre-matched
 * to a relPath — see schemas.ts's doc comment for why an unknown output
 * count can't be pre-provisioned 1:1. Files beyond the pool are reported
 * with `uploaded: false` rather than dropped silently.
 */
export async function handleExec(req: ExecRequest): Promise<ExecResult> {
  const ws = await hydrate(req.sources);
  try {
    const session: Session = {
      session_id: `worker_${randomUUID()}`,
      workspace: ws.root,
      created_at: new Date().toISOString(),
    };
    const output = await runCode(session, req.code, {
      timeoutMs: req.timeoutMs,
      memoryLimitMb: req.memoryLimitMb,
    });

    const produced = await collectOutputs(ws);
    const artifacts: ExecArtifactResult[] = [];
    for (let i = 0; i < produced.length; i++) {
      const file = produced[i];
      if (!file) continue;
      const slot = req.uploads[i];
      if (!slot) {
        artifacts.push({ relPath: file.relPath, size: file.size, uploaded: false });
        continue;
      }
      const upload = await uploadFile(slot.putUrl, file.absolutePath, "application/octet-stream");
      artifacts.push({
        relPath: file.relPath,
        size: file.size,
        uploaded: true,
        uploadStatus: upload.status,
        uploadBody: upload.body,
      });
    }

    return { ...output, artifacts };
  } finally {
    await ws.dispose();
  }
}
