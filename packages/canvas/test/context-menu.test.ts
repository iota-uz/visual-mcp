import assert from "node:assert/strict";
import test from "node:test";
import {
  contextMenuEntries,
  contextMenuPointerPolicy,
  nativeBodyKeepsContextMenu,
  placeContextMenu,
} from "../src/context-menu.js";

test("a finger suppresses the menu, a mouse opens it, and an opt-out keeps the native sheet", () => {
  assert.equal(contextMenuPointerPolicy({ enabled: true, pointerType: "touch" }), "suppress");
  assert.equal(contextMenuPointerPolicy({ enabled: true, pointerType: "mouse" }), "open");
  assert.equal(contextMenuPointerPolicy({ enabled: true, pointerType: "pen" }), "open");
  assert.equal(contextMenuPointerPolicy({ enabled: true, pointerType: null }), "open");
  assert.equal(contextMenuPointerPolicy({ enabled: false, pointerType: "mouse" }), "native");
});

test("selected native-body text keeps the browser menu", () => {
  assert.equal(nativeBodyKeepsContextMenu(true, { isCollapsed: false, rangeCount: 1 }), true);
  assert.equal(nativeBodyKeepsContextMenu(true, { isCollapsed: true, rangeCount: 1 }), false);
  assert.equal(nativeBodyKeepsContextMenu(false, { isCollapsed: false, rangeCount: 1 }), false);
  assert.equal(nativeBodyKeepsContextMenu(true, null), false);
});

test("empty canvas offers comment, fit, and zoom, and disables fit without a selection", () => {
  const empty = contextMenuEntries(
    { kind: "canvas", hasSelection: false },
    { comments: true, editable: true, copyLink: true },
  );
  assert.deepEqual(
    empty.map((entry) =>
      entry.type === "separator" ? "|" : `${entry.id}${entry.disabled ? ":off" : ""}`,
    ),
    ["add-comment", "|", "fit-selection:off", "fit-page", "zoom-100"],
  );

  const readonly = contextMenuEntries(
    { kind: "canvas", hasSelection: true },
    { comments: false, editable: false, copyLink: false },
  );
  assert.deepEqual(
    readonly.map((entry) => (entry.type === "separator" ? "|" : entry.id)),
    ["fit-selection", "fit-page", "zoom-100"],
  );
});

test("a single iframe node surfaces open, copy, and delete; a native node hides open", () => {
  const iframe = contextMenuEntries(
    { kind: "node", nodeKind: "iframe", hasRef: true },
    { comments: true, editable: true, copyLink: true },
  );
  assert.deepEqual(
    iframe.map((entry) => (entry.type === "separator" ? "|" : entry.id)),
    ["open-screen", "fit-selection", "add-comment", "copy-link", "copy-ref", "|", "delete"],
  );
  assert.equal(iframe.at(-1)?.type === "item" && iframe.at(-1).danger, true);

  const native = contextMenuEntries(
    { kind: "node", nodeKind: "native", hasRef: false },
    { comments: false, editable: false, copyLink: true },
  );
  assert.deepEqual(
    native.map((entry) => (entry.type === "separator" ? "|" : entry.id)),
    ["fit-selection", "copy-link"],
  );
});

test("multi-selection and groups stay short", () => {
  const multi = contextMenuEntries(
    { kind: "nodes" },
    { comments: true, editable: true, copyLink: true },
  );
  assert.deepEqual(
    multi.map((entry) => (entry.type === "separator" ? "|" : entry.id)),
    ["fit-selection", "|", "delete"],
  );

  const group = contextMenuEntries(
    { kind: "group" },
    { comments: true, editable: true, copyLink: true },
  );
  assert.deepEqual(
    group.map((entry) => (entry.type === "separator" ? "|" : entry.id)),
    ["fit-selection"],
  );
});

test("the menu opens beside the pointer and flips to stay inside the viewport", () => {
  const interior = placeContextMenu({
    pointerX: 40,
    pointerY: 40,
    menuWidth: 200,
    menuHeight: 160,
    viewportWidth: 800,
    viewportHeight: 600,
  });
  assert.equal(interior.x, 44);
  assert.equal(interior.y, 44);

  const corner = placeContextMenu({
    pointerX: 780,
    pointerY: 580,
    menuWidth: 200,
    menuHeight: 160,
    viewportWidth: 800,
    viewportHeight: 600,
  });
  assert.equal(corner.x, 780 - 200 - 4);
  assert.equal(corner.y, 580 - 160 - 4);
});
