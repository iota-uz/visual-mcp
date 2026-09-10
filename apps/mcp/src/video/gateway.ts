import { z } from "zod";
import type { AgentGateway } from "../gateway.js";
import type { McpPrincipal } from "../tools.js";
import { type VideoBackend, VideoDomainError, videoRecoverySchema } from "./registry.js";

const response = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string().optional(),
      effect: z.enum(["none", "not_applied", "applied", "partial", "unknown"]),
      recovery: videoRecoverySchema.optional(),
    }),
  }),
]);

/** The gateway revalidates this token; callers cannot supply their own identity. */
export function videoBackend(
  gateway: Pick<AgentGateway, "call">,
  principal: McpPrincipal,
): VideoBackend {
  const call: VideoBackend = async (name, input) => {
    const result = response.parse(
      await gateway.call("video", { tokenId: principal.tokenId, name, input }),
    );
    if (!result.ok)
      throw new VideoDomainError(
        result.error.code,
        result.error.message ??
          `Video operation failed (${result.error.code}); inspect the selected object and its original receipt.`,
        result.error.effect,
        result.error.recovery,
      );
    return result.data;
  };
  call.snapshotPrincipal = `${principal.userId}:${principal.tokenId}`;
  return call;
}
