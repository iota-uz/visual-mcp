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

const CANVASES = [
  {
    canvas_id: "cv_intake",
    slug: "claim-intake",
    title: "Claim intake",
    description: "A declarative canvas — lanes, stages, nodes, edges.",
    kind: "canvas",
    visibility: "private" as const,
    updated_at: now - 12 * MINUTE,
    thumbnail_url: null,
  },
  {
    canvas_id: "cv_settlement",
    slug: "fast-settlement",
    title: "Fast settlement",
    description: "Published, so the share section has something in it.",
    kind: "html",
    visibility: "public" as const,
    public_slug: "fixturepublicshare",
    updated_at: now - 3 * HOUR,
    thumbnail_url: null,
  },
  {
    canvas_id: "cv_coverage",
    slug: "coverage-map",
    title: "Coverage map",
    kind: "image",
    visibility: "private" as const,
    updated_at: now - 30 * HOUR,
    thumbnail_url: null,
  },
  {
    canvas_id: "cv_terms",
    slug: "policy-terms",
    title: "Policy terms, endorsements, and the schedule of benefits for the 2026 motor programme",
    description:
      "A long title and a long description, so text that overflows has somewhere to do it.",
    kind: "pdf",
    visibility: "private" as const,
    updated_at: now - 34 * DAY,
    thumbnail_url: null,
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
