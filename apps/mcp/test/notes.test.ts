import { type CanvasFile, CanvasFileSchema } from "@visual-canvas/canvas/types.js";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AgentContext } from "../src/gateway.js";
import { createApp } from "../src/index.js";
import { countHumanNotes, reconcileNoteAuthors, stampAgentNotes } from "../src/notes.js";

beforeEach(() => vi.stubEnv("SPA_ORIGIN", "https://canvas.example"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function file(notes: Array<Record<string, unknown>>): CanvasFile {
  return CanvasFileSchema.parse({
    version: 3,
    defaultPageId: "main",
    pages: [
      {
        id: "main",
        title: "Main",
        order: 0,
        doc: {
          version: 2,
          title: "Doc",
          world: { width: 1200, height: 800 },
          nodes: [
            {
              id: "card",
              kind: "native",
              shape: "card",
              rect: { x: 0, y: 0, w: 200, h: 100 },
              caption: { title: "Card" },
              anchors: [],
            },
          ],
          notes,
        },
      },
    ],
    prototype: { interactions: [] },
  });
}

const humanNote = { id: "fb", x: 10, y: 10, w: 200, text: "Make the CTA bigger", author: "human" };
const agentNote = { id: "an", x: 300, y: 10, w: 200, text: "Agent note", author: "agent" };

describe("stampAgentNotes", () => {
  const doc = file([humanNote, agentNote]).pages[0]!.doc;

  test("every added note is the agent's whatever the payload claims", () => {
    const [op] = stampAgentNotes(
      [{ op: "notes.add", value: { id: "n", x: 0, y: 0, w: 200, text: "hi", author: "human" } }],
      doc,
    );
    expect(op).toMatchObject({ op: "notes.add", value: { author: "agent" } });
  });

  test("update strips author and may move a human note", () => {
    const [op] = stampAgentNotes(
      [{ op: "notes.update", id: "fb", changes: { x: 500, author: "agent" } }],
      doc,
    );
    expect(op).toEqual({ op: "notes.update", id: "fb", changes: { x: 500 } });
  });

  test("update rejects a text change on a human note", () => {
    expect(() =>
      stampAgentNotes([{ op: "notes.update", id: "fb", changes: { text: "Done" } }], doc),
    ).toThrow(/note_owned_by_human: note "fb"/);
    expect(() =>
      stampAgentNotes([{ op: "notes.update", id: "an", changes: { text: "Done" } }], doc),
    ).not.toThrow();
  });

  test("replace keeps a human note's author and text, stamps agent otherwise", () => {
    const ops = stampAgentNotes(
      [
        { op: "notes.replace", id: "fb", value: { id: "fb", x: 1, y: 1, w: 300, color: "blue" } },
        { op: "notes.replace", id: "an", value: { id: "an", x: 1, y: 1, w: 300, text: "New" } },
      ],
      doc,
    );
    expect(ops[0]).toMatchObject({
      value: { text: "Make the CTA bigger", author: "human", color: "blue" },
    });
    expect(ops[1]).toMatchObject({ value: { text: "New", author: "agent" } });
    expect(() =>
      stampAgentNotes(
        [{ op: "notes.replace", id: "fb", value: { id: "fb", x: 1, y: 1, w: 300, text: "X" } }],
        doc,
      ),
    ).toThrow(/note_owned_by_human/);
  });
});

describe("reconcileNoteAuthors", () => {
  test("fills in agent authorship on a fresh document", () => {
    const raw = {
      version: 3,
      defaultPageId: "main",
      pages: [
        {
          id: "main",
          doc: {
            notes: [
              { id: "a", text: "x" },
              { id: "b", author: "human" },
            ],
          },
        },
      ],
    };
    const next = reconcileNoteAuthors(undefined, raw) as typeof raw;
    expect(next.pages[0]!.doc.notes.map((note) => note.author)).toEqual(["agent", "agent"]);
  });

  test("keeps the human's note and text when the agent re-saves the whole document", () => {
    const current = file([humanNote, agentNote]);
    const raw = {
      version: 3,
      defaultPageId: "main",
      pages: [
        {
          id: "main",
          doc: {
            notes: [
              { id: "fb", x: 99, y: 99, w: 200, color: "pink" },
              { id: "an", x: 0, y: 0, w: 200, text: "Rewritten" },
            ],
          },
        },
      ],
    };
    const next = reconcileNoteAuthors(current, raw) as typeof raw;
    expect(next.pages[0]!.doc.notes).toEqual([
      {
        id: "fb",
        x: 99,
        y: 99,
        w: 200,
        color: "pink",
        text: "Make the CTA bigger",
        author: "human",
      },
      { id: "an", x: 0, y: 0, w: 200, text: "Rewritten", author: "agent" },
    ]);
    expect(() =>
      reconcileNoteAuthors(current, {
        ...raw,
        pages: [{ id: "main", doc: { notes: [{ id: "fb", text: "Nope" }] } }],
      }),
    ).toThrow(/note_owned_by_human/);
  });

  test("leaves non-document values alone", () => {
    expect(reconcileNoteAuthors(undefined, "nope")).toBe("nope");
    expect(reconcileNoteAuthors(undefined, { pages: "x" })).toEqual({ pages: "x" });
  });
});

test("countHumanNotes scopes to a page when one is named", () => {
  const current = file([humanNote, agentNote]);
  expect(countHumanNotes(current)).toBe(1);
  expect(countHumanNotes(current, "main")).toBe(1);
  expect(countHumanNotes(current, "other")).toBe(0);
});

/* ------------------------------------------------------------------------
 * The tools themselves, over a fake AgentContext: the stored draft is what
 * decides authorship, whatever the tool call sent.
 * ---------------------------------------------------------------------- */

function harness(stored: CanvasFile) {
  const blobs = new Map<string, Blob>([
    ["doc-current", new Blob([JSON.stringify(stored)], { type: "application/json" })],
  ]);
  const mutations: Array<{ name: string; args: Record<string, unknown> }> = [];
  const detail = {
    workspace_slug: "demo",
    created_by_email: null,
    canvas: {
      canvas_id: "canvas",
      slug: "app",
      title: "App",
      kind: "canvas",
      visibility: "private",
      version: 1,
      draft_revision: 1,
      dirty: false,
      draft_edit_count: 0,
      updated_at: 1,
      theme_id: "clean-saas",
      public_slug: null,
      thumbnail_url: null,
      doc_url: "https://backend.example/blob/doc-current",
    },
    storage: { used_bytes: 100, quota_bytes: 1_000_000 },
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const match = /^https:\/\/backend\.example\/blob\/(.+)$/.exec(String(url));
    const blob = match ? blobs.get(match[1]!) : undefined;
    return blob ? new Response(blob) : new Response(null, { status: 404 });
  });
  const ctx = {
    runQuery: async (fn: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(fn as never);
      switch (name) {
        case "canvases:detailByRef":
          return detail;
        case "canvases:currentDocStorageByRef":
          return { storageId: "doc-current" };
        case "comments:openCount":
          return 0;
        case "canvases:upsertByRef":
          throw new Error("query");
        default:
          throw new Error(`Unexpected query ${name} ${JSON.stringify(args)}`);
      }
    },
    runMutation: async (fn: unknown, args: Record<string, unknown>) => {
      const name = getFunctionName(fn as never);
      mutations.push({ name, args });
      switch (name) {
        case "canvases:upsertByRef":
          return {
            canvasId: "canvas",
            workspaceSlug: "demo",
            canvasSlug: "app",
            created: false,
            themeId: "clean-saas",
          };
        case "canvases:commitSaveContent":
          return {
            versionId: "version",
            version: 1,
            previousVersion: 1,
            changed: true,
            draftRevision: 2,
            dirty: true,
            promotedAssets: [],
          };
        default:
          throw new Error(`Unexpected mutation ${name}`);
      }
    },
    storage: {
      get: async (storageId: string) => blobs.get(storageId) ?? null,
      getUrl: async (storageId: string) => `https://backend.example/blob/${storageId}`,
      store: async (blob: Blob) => {
        const id = `stored-${blobs.size}`;
        blobs.set(id, blob);
        return id;
      },
      delete: async () => null,
      generateUploadUrl: async () => "https://backend.example/upload",
    },
  } as unknown as AgentContext;
  const app = createApp({
    authenticate: async () => ({
      userId: "user",
      tokenId: "token",
      email: "agent@iota.uz",
      expiresAt: Date.now() + 60_000,
    }),
    actionContext: () => ctx,
  } as never);
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await app.request("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer test",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    });
    const text = await response.text();
    return JSON.parse(
      text.startsWith("event:")
        ? text
            .split(/\r?\n/)
            .find((line) => line.startsWith("data: "))!
            .slice(6)
        : text,
    ).result as { isError?: boolean; content: Array<{ text: string }>; structuredContent: never };
  };
  const committedDoc = async (): Promise<CanvasFile> => {
    const commit = mutations.find((m) => m.name === "canvases:commitSaveContent");
    if (!commit) throw new Error("no commitSaveContent mutation was recorded");
    const storageId = (commit.args.doc as { storageId: string }).storageId;
    return CanvasFileSchema.parse(JSON.parse(await blobs.get(storageId)!.text()));
  };
  return { call, committedDoc, mutations };
}

const base = { ref: "demo/app", expected_version: 1, expected_draft_revision: 1 };

describe("sticky notes over the MCP tools", () => {
  test("canvas_doc_patch stamps every added note as the agent's", async () => {
    const { call, committedDoc } = harness(file([humanNote]));
    const result = await call("canvas_doc_patch", {
      ...base,
      operations: [
        { op: "notes.add", value: { id: "n", x: 0, y: 0, w: 240, text: "Mine", author: "human" } },
        { op: "notes.update", id: "fb", changes: { x: 400, author: "agent" } },
      ],
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const notes = (await committedDoc()).pages[0]!.doc.notes;
    expect(notes).toEqual([
      { ...humanNote, x: 400, color: "yellow", size: "m" },
      { id: "n", x: 0, y: 0, w: 240, text: "Mine", author: "agent", color: "yellow", size: "m" },
    ]);
  });

  test("canvas_doc_patch refuses to rewrite a human note's text", async () => {
    const { call, mutations } = harness(file([humanNote]));
    const result = await call("canvas_doc_patch", {
      ...base,
      operations: [{ op: "notes.update", id: "fb", changes: { text: "Done" } }],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/note_owned_by_human/);
    expect(mutations).toHaveLength(0);
  });

  test("canvas_patch stamps notes inside page.doc.patch", async () => {
    const { call, committedDoc } = harness(file([humanNote]));
    const result = await call("canvas_patch", {
      ref: "demo/app",
      base: "v1.r1",
      operations: [
        {
          op: "page.doc.patch",
          page_id: "main",
          operations: [{ op: "notes.add", value: { id: "n", x: 0, y: 0, w: 240, text: "Mine" } }],
        },
      ],
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const notes = (await committedDoc()).pages[0]!.doc.notes;
    expect(notes.map((note) => [note.id, note.author])).toEqual([
      ["fb", "human"],
      ["n", "agent"],
    ]);
  });

  test("canvas_save keeps human authorship for an existing note id and stamps the rest", async () => {
    const stored = file([humanNote, agentNote]);
    const { call, committedDoc } = harness(stored);
    const resaved = JSON.parse(JSON.stringify(stored)) as CanvasFile;
    resaved.pages[0]!.doc.notes = [
      { id: "fb", x: 50, y: 50, w: 200, color: "green" } as never,
      { id: "new", x: 0, y: 0, w: 200, text: "Agent", author: "human" } as never,
    ];
    const result = await call("canvas_save", { ref: "demo/app", doc: resaved });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const notes = (await committedDoc()).pages[0]!.doc.notes;
    expect(notes).toEqual([
      {
        id: "fb",
        x: 50,
        y: 50,
        w: 200,
        color: "green",
        size: "m",
        text: "Make the CTA bigger",
        author: "human",
      },
      { id: "new", x: 0, y: 0, w: 200, text: "Agent", author: "agent", color: "yellow", size: "m" },
    ]);
  });

  test("canvas_get projects notes and counts the human ones", async () => {
    const { call } = harness(file([humanNote, agentNote]));
    const result = await call("canvas_get", {
      ref: "demo/app",
      doc_projection: { collections: ["notes"] },
    });
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    const structured = result.structuredContent as {
      canvas: { open_notes_by_human: number };
      doc: {
        activePage: { doc: { notes: unknown[]; nodes?: unknown; counts: { notes: number } } };
      };
    };
    expect(structured.canvas.open_notes_by_human).toBe(1);
    expect(structured.doc.activePage.doc.counts.notes).toBe(2);
    expect(structured.doc.activePage.doc.notes).toHaveLength(2);
    expect(structured.doc.activePage.doc.nodes).toBeUndefined();

    const summary = await call("canvas_get", { ref: "demo/app" });
    expect(
      (summary.structuredContent as { canvas: { open_notes_by_human: number } }).canvas
        .open_notes_by_human,
    ).toBe(1);
  });
});
