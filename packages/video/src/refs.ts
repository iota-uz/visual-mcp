import { z } from "zod";
export const AssetRef = z
  .object({ assetId: z.string().min(1), revisionId: z.string().min(1) })
  .strict();
export const ResourceRef = z
  .object({ resourceId: z.string().min(1), revisionId: z.string().min(1) })
  .strict();
