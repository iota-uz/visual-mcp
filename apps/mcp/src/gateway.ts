import { type FunctionReference, getFunctionName } from "convex/server";
import type { Id } from "../../../convex/_generated/dataModel.js";
import type { ActionCtx } from "../../../convex/_generated/server.js";

type GatewayResponse<T> = { result: T } | { error: string };

/**
 * Operations the Railway MCP runtime can perform through the agent gateway.
 * This intentionally excludes direct action calls and scheduling.
 */
export type AgentContext = Pick<ActionCtx, "runQuery" | "runMutation" | "storage">;

export class AgentGateway {
  readonly #url: string;
  readonly #secret: string;

  constructor(url = process.env.CONVEX_SITE_URL, secret = process.env.AGENT_GATEWAY_SECRET) {
    if (!url || !secret) throw new Error("CONVEX_SITE_URL and AGENT_GATEWAY_SECRET are required");
    this.#url = new URL("/agent-gateway", url).toString();
    this.#secret = secret;
  }

  async call<T>(operation: string, args?: unknown, name?: string): Promise<T> {
    const response = await fetch(this.#url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.#secret}` },
      body: JSON.stringify({ operation, name, args }),
    });
    const body = (await response.json().catch(() => null)) as GatewayResponse<T> | null;
    if (!response.ok || !body || "error" in body) {
      throw new Error(
        body && "error" in body ? body.error : `Convex gateway failed (${response.status})`,
      );
    }
    return body.result;
  }

  authenticate(tokenHash: string) {
    return this.call<null | {
      userId: Id<"users">;
      tokenId: Id<"mcpTokens">;
      email: string;
      expiresAt: number;
    }>("authenticate", { tokenHash });
  }

  async assertVideoContract(): Promise<void> {
    const contract = await this.call<{ version?: unknown }>("video.contract");
    if (contract.version !== 1) throw new Error("Convex Video backend contract is incompatible");
  }

  actionContext(): AgentContext {
    const run = <T>(
      operation: "query" | "mutation",
      fn: FunctionReference<"query" | "mutation">,
      args: unknown,
    ) => this.call<T>(operation, args, getFunctionName(fn));
    const generateUploadUrl = () => this.call<string>("storage.generateUploadUrl");
    const storage = {
      generateUploadUrl,
      getUrl: (storageId: string) => this.call<string | null>("storage.getUrl", { storageId }),
      getMetadata: (storageId: string) =>
        this.call<null | { contentType?: string; size: number; sha256: string }>(
          "storage.getMetadata",
          { storageId },
        ),
      delete: (storageId: string) => this.call<null>("storage.delete", { storageId }),
      get: async (storageId: string) => {
        const url = await this.call<string | null>("storage.getUrl", { storageId });
        if (!url) return null;
        const response = await fetch(url);
        return response.ok ? response.blob() : null;
      },
      store: async (blob: Blob) => {
        const uploadUrl = await generateUploadUrl();
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "content-type": blob.type || "application/octet-stream" },
          body: blob,
        });
        if (!response.ok) throw new Error(`Convex storage upload failed (${response.status})`);
        const body = (await response.json()) as { storageId?: unknown };
        if (typeof body.storageId !== "string")
          throw new Error("Convex storage upload returned no storageId");
        return body.storageId;
      },
    };
    return {
      runQuery: ((fn: FunctionReference<"query">, args: unknown) =>
        run("query", fn, args)) as AgentContext["runQuery"],
      runMutation: ((fn: FunctionReference<"mutation">, args: unknown) =>
        run("mutation", fn, args)) as AgentContext["runMutation"],
      storage: storage as unknown as AgentContext["storage"],
    };
  }
}
