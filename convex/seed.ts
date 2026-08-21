/**
 * Deterministic sample data for the isolated local stack (AGENTS.md,
 * "Local stack"). `npm run dev:agent` runs this; nothing else should.
 *
 * Why it exists: the live deployment holds two `html` canvases in two
 * workspaces, so a `kind: "canvas"` viewport, an empty workspace, a `pdf`
 * artifact and a dead share link were all unreachable to anyone reviewing
 * the UI — you could not look at half the surfaces the app has.
 *
 * Why it cannot run anywhere real: `DEV_AUTH_SECRET` is set on the local
 * backend and on nothing else, and `reset` wipes every table before it
 * writes. The guard is the first statement, not a comment.
 *
 * Storage blobs are why `reset` is an action: `ctx.storage.store` does not
 * exist in a mutation. The action stores the blobs, hands their ids to one
 * mutation that owns every row write, and then deletes whatever the
 * previous run left behind.
 */

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";

/** Signed in by /dev/sign-in, and the author of everything below. */
export const SEED_EMAIL = "agent@iota.uz";

/*
 * The MCP token the stack hands to agents. Fixed, so `npm run dev:agent` can
 * print it without a round trip and a re-run doesn't invalidate an already
 * configured client. The hash is precomputed because a Convex mutation runs
 * in a deterministic isolate with no `node:crypto`; keep the two in step —
 *   node -e 'console.log(require("node:crypto").createHash("sha256").update("<token>").digest("hex"))'
 * This is a local-only credential against a backend bound to 127.0.0.1.
 */
export const SEED_MCP_TOKEN = "vct_localdevagenttoken0000000000000000";
const SEED_MCP_TOKEN_HASH = "9777f0b633e8e6ada8ee77ff952141387305297480d72c2bec7ff33d698017d3";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A small but complete strict CanvasFile v3 — one Page with a CanvasDoc v2. */
const CANVAS_FILE = {
  version: 3,
  defaultPageId: "overview",
  pages: [
    {
      id: "overview",
      title: "Overview",
      order: 0,
      doc: {
        version: 2,
        title: "Claim intake",
        subtitle: "Seeded locally so the kind=canvas viewport has something to draw",
        world: { width: 1_500, height: 780 },
        lanes: [
          {
            id: "people",
            label: "People",
            role: "actors",
            rect: { x: 40, y: 70, w: 1_420, h: 180 },
          },
          {
            id: "app",
            label: "Product",
            role: "primary",
            rect: { x: 40, y: 285, w: 1_420, h: 205 },
          },
          {
            id: "jobs",
            label: "Automation",
            role: "automation",
            rect: { x: 40, y: 525, w: 1_420, h: 175 },
          },
        ],
        stages: [
          {
            id: "s1",
            index: 0,
            label: "Report",
            summary: "The claimant opens a claim",
            rect: { x: 40, y: 40, w: 460, h: 680 },
          },
          {
            id: "s2",
            index: 1,
            label: "Assess",
            summary: "Damage is priced",
            rect: { x: 500, y: 40, w: 480, h: 680 },
          },
          {
            id: "s3",
            index: 2,
            label: "Settle",
            rect: { x: 980, y: 40, w: 480, h: 680 },
          },
        ],
        labels: [],
        nodes: [
          {
            id: "claimant",
            kind: "native",
            shape: "actor",
            laneId: "people",
            stageId: "s1",
            rect: { x: 90, y: 115, w: 230, h: 100 },
            caption: { title: "Claimant", subtitle: "Web and mobile" },
            body: { text: "Starts a claim from any device." },
            anchors: [{ id: "right", side: "right", offset: 0.5 }],
          },
          {
            id: "intake",
            kind: "native",
            shape: "screen",
            laneId: "app",
            stageId: "s1",
            rect: { x: 170, y: 325, w: 270, h: 135 },
            caption: { title: "Intake form", tag: "3 steps" },
            maturity: "live",
            body: { text: "Photos, plate number, and a short description." },
            anchors: [
              { id: "left", side: "left", offset: 0.5 },
              { id: "right", side: "right", offset: 0.5 },
              { id: "bottom", side: "bottom", offset: 0.5 },
            ],
            inspector: {
              eyebrow: "Screen",
              title: "Intake form",
              copy: "Collects the minimum needed to price the claim.",
              points: ["Autosaves per step", "Photos go straight to storage"],
            },
          },
          {
            id: "pricing",
            kind: "native",
            shape: "automation",
            laneId: "jobs",
            stageId: "s2",
            rect: { x: 625, y: 560, w: 250, h: 105 },
            caption: { title: "Pricing engine" },
            maturity: "partial",
            anchors: [
              { id: "left", side: "left", offset: 0.5 },
              { id: "right", side: "right", offset: 0.5 },
              { id: "top", side: "top", offset: 0.5 },
            ],
          },
          {
            id: "review",
            kind: "native",
            shape: "window",
            laneId: "app",
            stageId: "s2",
            rect: { x: 660, y: 325, w: 270, h: 135 },
            caption: { title: "Adjuster review" },
            anchors: [
              { id: "left", side: "left", offset: 0.5 },
              { id: "right", side: "right", offset: 0.5 },
              { id: "bottom", side: "bottom", offset: 0.5 },
            ],
          },
          {
            id: "payout",
            kind: "native",
            shape: "service",
            laneId: "app",
            stageId: "s3",
            rect: { x: 1_120, y: 325, w: 230, h: 135 },
            caption: { title: "Payout" },
            maturity: "to-be",
            anchors: [{ id: "left", side: "left", offset: 0.5 }],
          },
        ],
        edges: [
          {
            id: "claimant-intake",
            source: { nodeId: "claimant", anchorId: "right" },
            target: { nodeId: "intake", anchorId: "left" },
            kind: "actor",
            route: { type: "orthogonal" },
          },
          {
            id: "intake-pricing",
            source: { nodeId: "intake", anchorId: "bottom" },
            target: { nodeId: "pricing", anchorId: "left" },
            kind: "main",
            route: { type: "orthogonal" },
          },
          {
            id: "pricing-review",
            source: { nodeId: "pricing", anchorId: "top" },
            target: { nodeId: "review", anchorId: "bottom" },
            kind: "main",
            route: { type: "orthogonal" },
          },
          {
            id: "review-payout",
            source: { nodeId: "review", anchorId: "right" },
            target: { nodeId: "payout", anchorId: "left" },
            kind: "main",
            route: { type: "orthogonal" },
            label: { text: "approved" },
          },
          {
            id: "review-intake",
            source: { nodeId: "review", anchorId: "left" },
            target: { nodeId: "intake", anchorId: "right" },
            kind: "exception",
            route: { type: "bezier" },
            label: { text: "needs more photos" },
          },
        ],
        legend: [
          {
            title: "Status",
            items: [
              { label: "Live", maturity: "live" },
              { label: "In progress", maturity: "partial" },
              { label: "Planned", maturity: "to-be" },
            ],
          },
        ],
      },
    },
  ],
  prototype: { interactions: [] },
};

/** Self-contained, so it renders in the viewer's iframe with no subresources. */
const HTML_ENTRY = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Settlement summary</title>
<style>
  body { margin:0; font:16px/1.5 ui-sans-serif,system-ui,sans-serif; color:#0b1b2b;
         background:#fbfaf7; padding:48px; }
  h1 { font-size:28px; margin:0 0 4px; }
  p.lead { color:#5b6e85; margin:0 0 32px; }
  table { border-collapse:collapse; width:100%; max-width:640px; }
  th,td { text-align:left; padding:10px 12px; border-bottom:1px solid #e4e0d8; }
  th { font:600 11px/1 ui-monospace,monospace; letter-spacing:.11em;
       text-transform:uppercase; color:#5b6e85; }
  td.n { text-align:right; font-variant-numeric:tabular-nums; }
</style></head>
<body>
  <h1>Settlement summary</h1>
  <p class="lead">Seeded by convex/seed.ts — this page is local sample data.</p>
  <table>
    <thead><tr><th>Line</th><th>Basis</th><th>Amount</th></tr></thead>
    <tbody>
      <tr><td>Front bumper</td><td>Parts + labour</td><td class="n">1 240 000</td></tr>
      <tr><td>Headlight, left</td><td>Parts</td><td class="n">860 000</td></tr>
      <tr><td>Paint</td><td>Two panels</td><td class="n">410 000</td></tr>
    </tbody>
  </table>
</body></html>`;

const SVG_ENTRY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 320" width="480" height="320">
  <rect width="480" height="320" fill="#fbfaf7"/>
  <circle cx="150" cy="160" r="76" fill="#2f6df6" opacity="0.16"/>
  <circle cx="230" cy="160" r="76" fill="#7a56b2" opacity="0.16"/>
  <text x="240" y="286" text-anchor="middle" font-family="ui-monospace, monospace"
        font-size="13" fill="#5b6e85">seeded image canvas</text>
</svg>`;

/** The smallest structurally valid PDF: one empty A4 page. */
const PDF_ENTRY = [
  "%PDF-1.4",
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj",
  "trailer<</Root 1 0 R>>",
  "%%EOF",
].join("\n");

function assertLocalStack() {
  if (!process.env.DEV_AUTH_SECRET) {
    throw new Error(
      "seed refuses to run: DEV_AUTH_SECRET is unset, so this is not the local agent stack. " +
        "Run `npm run dev:agent` instead of pointing this at a real deployment.",
    );
  }
}

/**
 * Annotated explicitly, and it matters: `reset` calls `internal.seed.write`,
 * so without a declared return type TypeScript walks back into the generated
 * `api.d.ts` that is being derived from this very file, gives up, and types
 * the whole API surface `any` — which shows up as dozens of errors in
 * unrelated files rather than as one error here.
 */
export interface SeedSummary {
  email: string;
  mcp_token: string;
  workspaces: string[];
  canvases: number;
  public_slug: string;
  dead_public_slug: string;
}

export const reset = internalAction({
  args: {},
  handler: async (ctx): Promise<SeedSummary> => {
    assertLocalStack();

    const docStorageId = await ctx.storage.store(
      new Blob([JSON.stringify(CANVAS_FILE)], { type: "application/json" }),
    );
    const htmlStorageId = await ctx.storage.store(new Blob([HTML_ENTRY], { type: "text/html" }));
    const svgStorageId = await ctx.storage.store(new Blob([SVG_ENTRY], { type: "image/svg+xml" }));
    const pdfStorageId = await ctx.storage.store(
      new Blob([PDF_ENTRY], { type: "application/pdf" }),
    );

    const result = await ctx.runMutation(internal.seed.write, {
      docStorageId,
      htmlStorageId,
      svgStorageId,
      pdfStorageId,
    });

    // Whatever the previous run stored is unreferenced now. Deleting it
    // keeps repeated resets from growing the local backend without bound.
    // Deduplicated: one blob is referenced twice (a version's entry and the
    // artifact row for the same file), and deleting it twice throws.
    for (const id of new Set(result.orphanedStorageIds)) {
      await ctx.storage.delete(id);
    }

    return {
      email: SEED_EMAIL,
      mcp_token: SEED_MCP_TOKEN,
      workspaces: result.workspaces,
      canvases: result.canvases,
      public_slug: result.publicSlug,
      dead_public_slug: result.deadPublicSlug,
    };
  },
});

export const write = internalMutation({
  args: {
    docStorageId: v.id("_storage"),
    htmlStorageId: v.id("_storage"),
    svgStorageId: v.id("_storage"),
    pdfStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    assertLocalStack();

    // Wipe first, so a reset is a reset. Every table the app writes, plus
    // the auth library's own — otherwise a stale authAccounts row points at
    // a user id that no longer exists and sign-in fails in a confusing way.
    const orphanedStorageIds: Id<"_storage">[] = [];
    for (const table of [
      "renders",
      "artifacts",
      "canvasVersionAssets",
      "canvasAssetBindings",
      "assetVersions",
      "assetUploads",
      "assets",
      "canvasFiles",
      "canvasNodes",
      "canvasVersions",
      "canvases",
      "workspaces",
      "mcpTokens",
      "users",
      "authAccounts",
      "authSessions",
      "authRefreshTokens",
      "authVerificationCodes",
      "authVerifiers",
      "authRateLimits",
    ] as const) {
      for (const row of await ctx.db.query(table).collect()) {
        for (const key of [
          "storageId",
          "docStorageId",
          "cssStorageId",
          "entryStorageId",
          "thumbnailId",
        ] as const) {
          const value = (row as Record<string, unknown>)[key];
          if (typeof value === "string") orphanedStorageIds.push(value as Id<"_storage">);
        }
        await ctx.db.delete(row._id);
      }
    }

    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: SEED_EMAIL,
      name: "Agent",
      lastSeenAt: now,
    });

    await ctx.db.insert("mcpTokens", {
      userId,
      name: "local agent stack",
      prefix: SEED_MCP_TOKEN.slice(0, 12),
      tokenHash: SEED_MCP_TOKEN_HASH,
      expiresAt: now + 365 * DAY,
      lastUsedAt: now - 3 * MINUTE,
    });
    // A second one, revoked, so the tokens page has more than one state.
    await ctx.db.insert("mcpTokens", {
      userId,
      name: "laptop (revoked)",
      prefix: "vct_revoked1",
      tokenHash: "revoked-placeholder-never-matches-a-real-sha256",
      expiresAt: now + 30 * DAY,
      revokedAt: now - 2 * DAY,
    });

    const osago = await ctx.db.insert("workspaces", {
      slug: "osago",
      name: "OSAGO",
      description: "Motor claims — the populated workspace.",
      createdBy: userId,
    });
    const empty = await ctx.db.insert("workspaces", {
      slug: "sandbox",
      name: "Sandbox",
      description: "Deliberately empty, so the empty state is reachable.",
      createdBy: userId,
    });

    // A storage-independent lifecycle fixture: move/archive operate only on
    // metadata and immutable version ids, so MCP can exercise them locally
    // even though the agent stack intentionally has no Railway object store.
    const lifecycleAssetId = await ctx.db.insert("assets", {
      scope: "workspace",
      workspaceId: osago,
      slug: "lifecycle-logo",
      name: "Lifecycle logo",
      description: "Local fixture for asset_move and asset_delete.",
      tags: ["fixture", "brand"],
      kind: "image",
      searchText: "Lifecycle logo lifecycle-logo fixture brand",
      createdBy: userId,
      updatedAt: now,
    });
    await ctx.db.insert("assetVersions", {
      assetId: lifecycleAssetId,
      revision: 1,
      sourceObjectKey: "local-fixture/source/lifecycle-logo",
      deliveryObjectKey: "local-fixture/delivery/lifecycle-logo",
      previewObjectKey: "local-fixture/delivery/lifecycle-logo",
      contentHash: "local-fixture-lifecycle-logo",
      mimeType: "image/png",
      size: 1,
      originalFilename: "lifecycle-logo.png",
      sourceType: "upload",
      createdBy: userId,
    });

    async function addCanvas(input: {
      slug: string;
      title: string;
      description?: string;
      kind: "canvas" | "html" | "image" | "pdf";
      updatedAt: number;
      publicSlug?: string;
      /** Set for kind=canvas. */
      docStorageId?: Id<"_storage">;
      /** Set for the other three; also registered as the primary artifact. */
      entry?: {
        storageId: Id<"_storage">;
        relPath: string;
        mimeType: string;
        type: "pdf" | "image" | "svg" | "source";
        size: number;
      };
    }) {
      const canvasId = await ctx.db.insert("canvases", {
        workspaceId: osago,
        slug: input.slug,
        title: input.title,
        description: input.description,
        kind: input.kind,
        visibility: input.publicSlug ? "public" : "private",
        publicSlug: input.publicSlug,
        draftRevision: 0,
        draftEditCount: 0,
        draftUpdatedAt: input.updatedAt,
        draftDocStorageId: input.docStorageId,
        draftEntryStorageId: input.entry?.storageId,
        draftIframeEntrypoints: [],
        storageBytesUsed: 0,
        createdBy: userId,
        updatedAt: input.updatedAt,
      });

      const versionId = await ctx.db.insert("canvasVersions", {
        canvasId,
        version: 1,
        note: "seeded",
        createdBy: userId,
        docStorageId: input.docStorageId,
        entryStorageId: input.entry?.storageId,
        iframeEntrypoints: [],
      });
      await ctx.db.patch(canvasId, {
        currentVersionId: versionId,
        publishedVersionId: input.publicSlug ? versionId : undefined,
      });

      if (input.entry) {
        await ctx.db.insert("artifacts", {
          canvasId,
          versionId,
          relPath: input.entry.relPath,
          type: input.entry.type,
          role: "primary",
          mimeType: input.entry.mimeType,
          size: input.entry.size,
          storageId: input.entry.storageId,
        });
      }
      return canvasId;
    }

    // A second version on one canvas, so version history has a "restore"
    // row rather than a single line saying "v1 current".
    const claimIntake = await addCanvas({
      slug: "claim-intake",
      title: "Claim intake",
      description: "kind=canvas — the declarative viewport, lanes and edges and all.",
      kind: "canvas",
      updatedAt: now - 12 * MINUTE,
      docStorageId: args.docStorageId,
    });
    await ctx.db.insert("canvasVersions", {
      canvasId: claimIntake,
      version: 2,
      note: "second seeded version, so history is not a single row",
      createdBy: userId,
      iframeEntrypoints: [],
    });

    await addCanvas({
      slug: "fast-settlement",
      title: "Fast settlement",
      description: "kind=html, published — open /s/<slug> to see the public shell.",
      kind: "html",
      updatedAt: now - 3 * HOUR,
      publicSlug: "seedpublicshare000000000000",
      entry: {
        storageId: args.htmlStorageId,
        relPath: "/output/index.html",
        mimeType: "text/html",
        type: "source",
        size: HTML_ENTRY.length,
      },
    });

    await addCanvas({
      slug: "coverage-map",
      title: "Coverage map",
      kind: "image",
      updatedAt: now - 30 * HOUR,
      entry: {
        storageId: args.svgStorageId,
        relPath: "/output/coverage.svg",
        mimeType: "image/svg+xml",
        type: "svg",
        size: SVG_ENTRY.length,
      },
    });

    await addCanvas({
      slug: "policy-terms",
      title:
        "Policy terms, endorsements, and the schedule of benefits for the 2026 motor programme",
      description:
        "A deliberately long title and a deliberately long description, so text that overflows its container has somewhere to do it. kind=pdf, and the viewer falls back to opening it in a new tab.",
      kind: "pdf",
      updatedAt: now - 34 * DAY,
      entry: {
        storageId: args.pdfStorageId,
        relPath: "/output/terms.pdf",
        mimeType: "application/pdf",
        type: "pdf",
        size: PDF_ENTRY.length,
      },
    });

    return {
      orphanedStorageIds,
      workspaces: ["osago", "sandbox"],
      canvases: 4,
      publicSlug: "seedpublicshare000000000000",
      // Never minted, so /s/<this> exercises "this link doesn't work".
      deadPublicSlug: "seeddeadshare0000000000000",
      emptyWorkspace: empty,
    };
  },
});
