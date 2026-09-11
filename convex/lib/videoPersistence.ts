import { type Infer, v } from "convex/values";

export const PersistenceArtifactValidator = v.object({
  role: v.string(),
  objectKey: v.string(),
  leaseId: v.optional(v.string()),
  sha256: v.optional(v.string()),
  sizeBytes: v.optional(v.number()),
  mimeType: v.optional(v.string()),
});

const receiptFields = {
  kind: v.string(),
  artifacts: v.array(PersistenceArtifactValidator),
  result: v.optional(v.string()),
  metadata: v.optional(v.string()),
  persistedRoles: v.optional(v.array(v.string())),
  provider: v.optional(
    v.object({
      requestId: v.string(),
      statusUrl: v.optional(v.string()),
      cancelUrl: v.optional(v.string()),
    }),
  ),
};

/** Durable byte lifecycle. Job stage is presentation/progress, never persistence authority. */
export const PersistenceReceiptValidator = v.union(
  v.object({ state: v.literal("reserved"), ...receiptFields }),
  v.object({ state: v.literal("partially_persisted"), ...receiptFields }),
  v.object({ state: v.literal("persisted"), ...receiptFields }),
  v.object({ state: v.literal("source_unavailable"), ...receiptFields }),
);

export type PersistenceReceipt = Infer<typeof PersistenceReceiptValidator>;

export function persistenceStage(receipt: PersistenceReceipt) {
  if (receipt.state === "source_unavailable") return "recovery_source_unavailable";
  if (receipt.state === "partially_persisted") return "outputs_partial";
  if (receipt.state === "persisted") return "bytes_persisted";
  return receipt.kind === "shot" ? "provider_submitted" : "outputs_reserved";
}

export function markSourceUnavailable(receipt: PersistenceReceipt): PersistenceReceipt {
  return { ...receipt, state: "source_unavailable" };
}
