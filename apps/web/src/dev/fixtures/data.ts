/**
 * The data the fixture backend answers with, per scenario.
 *
 * Kept apart from the fake client so that adding a case is editing a
 * literal, not editing a dispatcher. Ids are strings the app only ever
 * echoes back into a URL, so they can be readable.
 */

export type Scenario = "full" | "empty" | "loading" | "error";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/*
 * Fixed relative to load, not to a wall-clock date: the point of these rows
 * is that "12 minutes ago" reads as 12 minutes ago every time you look.
 */
const now = Date.now();

/*
 * A poster with real geometry, so the schematic cover renders here and not
 * only against a seeded backend. The empty-canvas branch — a poster with no
 * rects, which is a different fact from `poster: null` — is covered by
 * CanvasCover.test.tsx rather than by inventing a fifth fixture row.
 */
const POSTER = {
  format: 1 as const,
  ar: 1.4,
  n: 6,
  p: 2,
  rects: [
    { x: 0, y: 0, w: 180, h: 220, r: "actors" as const },
    { x: 240, y: 40, w: 220, h: 180, r: "primary" as const },
    { x: 520, y: 0, w: 300, h: 260, r: "primary" as const, k: "iframe" as const },
    { x: 240, y: 380, w: 220, h: 200, r: "automation" as const },
    { x: 560, y: 420, w: 240, h: 180, r: "exception" as const },
    { x: 860, y: 300, w: 140, h: 700, r: "system" as const },
  ],
};

/**
 * A 4x3 PNG, so the real-thumbnail branch is reachable without a worker:
 * every row here used to be `thumbnail_url: null`, which meant the branch
 * the gallery prefers was never exercised by a fixture.
 */
const THUMBNAIL_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#dce4ed"/><rect x="0.4" y="0.4" width="1.4" height="0.9" fill="#2f6df6"/><rect x="2.2" y="1.4" width="1.4" height="1.2" fill="#7a56b2"/></svg>',
  );

const CANVASES = [
  {
    canvas_id: "cv_intake",
    slug: "claim-intake",
    title: "Claim intake",
    description: "A declarative canvas — lanes, stages, nodes, edges.",
    kind: "canvas",
    visibility: "private" as const,
    static_render_status: "updating" as const,
    updated_at: now - 12 * MINUTE,
    thumbnail_url: null,
    poster: POSTER,
  },
  {
    canvas_id: "cv_settlement",
    slug: "fast-settlement",
    title: "Fast settlement",
    description: "Published, so the share section has something in it.",
    kind: "html",
    visibility: "public" as const,
    static_render_status: "stale" as const,
    public_slug: "fixturepublicshare",
    updated_at: now - 3 * HOUR,
    // The one row with a real picture: a PNG always wins over a poster.
    thumbnail_url: THUMBNAIL_URL,
    poster: null,
  },
  {
    canvas_id: "cv_coverage",
    slug: "coverage-map",
    title: "Coverage map",
    kind: "image",
    visibility: "private" as const,
    static_render_status: "error" as const,
    updated_at: now - 30 * HOUR,
    thumbnail_url: null,
    poster: null,
  },
  {
    canvas_id: "cv_terms",
    slug: "policy-terms",
    title: "Policy terms, endorsements, and the schedule of benefits for the 2026 motor programme",
    description:
      "A long title and a long description, so text that overflows has somewhere to do it.",
    kind: "pdf",
    visibility: "private" as const,
    static_render_status: "ready" as const,
    updated_at: now - 34 * DAY,
    // kind=pdf has no document to derive geometry from, so it never gets a
    // poster and falls through to its kind plate.
    thumbnail_url: null,
    poster: null,
  },
];

const WORKSPACES = [
  {
    workspace_id: "ws_osago",
    slug: "osago",
    name: "OSAGO",
    description: "Motor claims.",
    canvas_count: CANVASES.length,
    recent: CANVASES.slice(0, 4).map((c) => ({
      canvas_id: c.canvas_id,
      title: c.title,
      kind: c.kind,
      thumbnail_url: c.thumbnail_url,
      poster: c.poster,
      static_render_status: c.static_render_status,
    })),
  },
  {
    workspace_id: "ws_sandbox",
    slug: "sandbox",
    name: "Sandbox",
    description: "Deliberately empty.",
    canvas_count: 0,
    recent: [],
  },
];

const USER = {
  user_id: "u_agent",
  email: "agent@iota.uz",
  name: "Agent",
  picture_url: null,
};

const TOKENS = [
  {
    token_id: "tk_live",
    name: "laptop",
    prefix: "vct_abc12345",
    created_at: now - 9 * DAY,
    expires_at: now + 81 * DAY,
    last_used_at: now - 3 * MINUTE,
  },
  {
    token_id: "tk_expiring",
    name: "ci",
    prefix: "vct_def67890",
    created_at: now - 76 * DAY,
    expires_at: now + 9 * DAY,
    last_used_at: null,
  },
  {
    token_id: "tk_revoked",
    name: "old desktop",
    prefix: "vct_ghi13579",
    created_at: now - 120 * DAY,
    expires_at: now + 30 * DAY,
    last_used_at: now - 40 * DAY,
    revoked_at: now - 2 * DAY,
  },
];

/** What each query returns, by its Convex function name. */
export function fixtureFor(name: string, scenario: Scenario): unknown {
  const empty = scenario === "empty";

  switch (name) {
    case "users:getCurrentUser":
      return USER;
    case "workspaces:listMine":
      return empty ? [] : WORKSPACES;
    case "workspaces:getBySlug":
    case "workspaces:getById":
      return empty ? null : WORKSPACES[0];
    case "canvases:listForWorkspace":
      return empty ? [] : CANVASES;
    case "canvases:getMine":
    case "canvases:getPublic":
      return empty
        ? null
        : { ...CANVASES[0], workspace_id: "ws_osago", doc_url: null, css_url: null, version: 3 };
    case "canvases:listVersionsMine":
      return empty
        ? []
        : [
            { version_id: "v3", version: 3, created_at: now - 12 * MINUTE, author: USER.email },
            { version_id: "v2", version: 2, created_at: now - DAY, author: USER.email },
            { version_id: "v1", version: 1, created_at: now - 4 * DAY, author: USER.email },
          ];
    case "canvases:searchNodes":
      return empty ? [] : [];
    case "tokens:listMine":
      return empty ? [] : TOKENS;
    default:
      // Better a visible null than a silent undefined that reads as
      // "still loading" and hangs the surface on a skeleton forever.
      return null;
  }
}
