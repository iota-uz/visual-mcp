export type ParsedAssetRef =
  | { scope: "shared"; slug: string; revision?: number }
  | { scope: "workspace"; workspaceSlug: string; slug: string; revision?: number };

const SEGMENT = /^[a-z0-9][a-z0-9-]*$/;

export function parseAssetRef(ref: string): ParsedAssetRef {
  const shared = /^asset:\/\/shared\/([^/@]+)(?:@(\d+))?$/.exec(ref);
  if (shared) {
    if (!SEGMENT.test(shared[1] as string)) throw new Error(`Invalid asset ref: ${ref}`);
    return {
      scope: "shared",
      slug: shared[1] as string,
      revision: shared[2] ? Number(shared[2]) : undefined,
    };
  }
  const workspace = /^asset:\/\/workspace\/([^/]+)\/([^/@]+)(?:@(\d+))?$/.exec(ref);
  if (workspace) {
    if (!SEGMENT.test(workspace[1] as string) || !SEGMENT.test(workspace[2] as string)) {
      throw new Error(`Invalid asset ref: ${ref}`);
    }
    return {
      scope: "workspace",
      workspaceSlug: workspace[1] as string,
      slug: workspace[2] as string,
      revision: workspace[3] ? Number(workspace[3]) : undefined,
    };
  }
  throw new Error(`Invalid asset ref: ${ref}`);
}

export function formatAssetRef(input: {
  scope: "shared" | "workspace";
  workspaceSlug?: string;
  slug: string;
  revision: number;
}): string {
  return input.scope === "shared"
    ? `asset://shared/${input.slug}@${input.revision}`
    : `asset://workspace/${input.workspaceSlug}/${input.slug}@${input.revision}`;
}
