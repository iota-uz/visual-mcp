export type ParsedAssetRef =
  | { scope: "personal"; slug: string; revision?: number }
  | { scope: "workspace"; workspaceSlug: string; slug: string; revision?: number };

const SEGMENT = /^[a-z0-9][a-z0-9-]*$/;

export function parseAssetRef(ref: string): ParsedAssetRef {
  const personal = /^asset:\/\/personal\/([^/@]+)(?:@(\d+))?$/.exec(ref);
  if (personal) {
    if (!SEGMENT.test(personal[1] as string)) throw new Error(`Invalid asset ref: ${ref}`);
    return {
      scope: "personal",
      slug: personal[1] as string,
      revision: personal[2] ? Number(personal[2]) : undefined,
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
  scope: "personal" | "workspace";
  workspaceSlug?: string;
  slug: string;
  revision: number;
}): string {
  return input.scope === "personal"
    ? `asset://personal/${input.slug}@${input.revision}`
    : `asset://workspace/${input.workspaceSlug}/${input.slug}@${input.revision}`;
}
