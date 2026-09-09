import assert from "node:assert/strict";
import test from "node:test";
import {
  findScreenElement,
  flattenScreenTree,
  isStampableHtmlPath,
  screenTree,
  stampHtmlSource,
  stampVcIds,
} from "../src/vc-id.js";

test("stampVcIds is surgical and idempotent", () => {
  const html = `<!doctype html>\n<main>\n  <h1>Invite</h1>\n  <button>Submit claim</button>\n</main>\n`;
  const stamped = stampVcIds(html);
  assert.match(stamped, /<h1 data-vc-id="invite">Invite<\/h1>/);
  assert.match(stamped, /<button data-vc-id="submit-claim">Submit claim<\/button>/);
  assert.equal(stampVcIds(stamped), stamped);
  assert.equal(stamped.startsWith("<!doctype html>\n<main>\n  "), true);
});

test("author-supplied data-vc-id is kept when valid and unique", () => {
  const html = `<button data-vc-id="pay-now">Pay</button><button>Pay</button>`;
  const stamped = stampVcIds(html);
  assert.match(stamped, /data-vc-id="pay-now"/);
  assert.notEqual(stamped.match(/data-vc-id="pay"/), null);
  const ids = flattenScreenTree(screenTree(stamped)).map((node) => node.el);
  assert.deepEqual(new Set(ids).size, ids.length);
  assert.ok(ids.includes("pay-now"));
});

test("invalid author ids are replaced, hidden inputs are skipped", () => {
  const html = `<input type="hidden" name="csrf"><input data-vc-id="Nope" placeholder="Email">`;
  const stamped = stampVcIds(html);
  assert.equal(stamped.includes('type="hidden"'), true);
  assert.equal(stamped.includes('data-vc-id="Nope"'), false);
  assert.match(stamped, /data-vc-id="email"/);
  assert.equal(flattenScreenTree(screenTree(stamped)).length, 1);
});

test("label[for] names the control; role comes from the tag", () => {
  const html = `<label for="mail">Work email</label><input id="mail" type="email">`;
  const tree = flattenScreenTree(screenTree(html));
  const input = tree.find((node) => node.tag === "input");
  assert.equal(input?.name, "Work email");
  assert.equal(input?.role, "textbox");
  assert.ok(input?.el);
  assert.ok(tree.some((node) => node.el === "work-email"));
});

test("aria-label wins over inner text", () => {
  const html = `<button aria-label="Close dialog">✕</button>`;
  const [node] = flattenScreenTree(screenTree(html));
  assert.equal(node?.name, "Close dialog");
  assert.equal(node?.el, "close-dialog");
  assert.equal(node?.role, "button");
});

test("screenTree nests stamped children and findScreenElement looks them up", () => {
  const html = `<section><h1>Review</h1><form><button>Confirm</button></form></section>`;
  const flat = flattenScreenTree(screenTree(html));
  assert.deepEqual(
    flat.map((node) => node.el),
    ["review", "confirm"],
  );
  assert.equal(findScreenElement(html, "confirm")?.role, "button");

  const nested = screenTree(`<label>Email <input type="email"></label>`);
  assert.equal(nested[0]?.tag, "label");
  assert.equal(nested[0]?.children[0]?.tag, "input");
  assert.equal(nested[0]?.children[0]?.name, "Email");
});

test("script and style bodies are not parsed as elements", () => {
  const html = `<script>document.write('<button>Nope</button>')</script><button>Go</button><style>button{}</style>`;
  const stamped = stampVcIds(html);
  assert.equal(stamped.includes("<button>Nope</button>"), true);
  assert.match(stamped, /<button data-vc-id="go">Go<\/button>/);
  assert.equal(flattenScreenTree(screenTree(stamped)).length, 1);
});

test("self-closing inputs keep their slash", () => {
  const html = `<input type="text" placeholder="Phone"/>`;
  assert.equal(stampVcIds(html), `<input type="text" placeholder="Phone" data-vc-id="phone"/>`);
});

test("non-latin names fall back to a hash id", () => {
  const html = `<h1>Привет</h1>`;
  const [node] = flattenScreenTree(screenTree(html));
  assert.equal(node?.name, "Привет");
  assert.match(node?.el ?? "", /^el-[0-9a-f]{8}$/);
});

test("stampHtmlSource only touches real screen HTML", () => {
  const html = `<button>X</button>`;
  assert.equal(isStampableHtmlPath("/src/screens/index.html"), true);
  assert.equal(isStampableHtmlPath("/src/__canvas.html"), false);
  assert.equal(isStampableHtmlPath("/src/app.css"), false);
  assert.match(stampHtmlSource("/src/screens/home.html", html), /data-vc-id/);
  assert.equal(stampHtmlSource("/src/__canvas.html", html), html);
});

test("role=button on a div is stamped; a bare div is not", () => {
  const html = `<div>plain</div><div role="button">Do it</div>`;
  const stamped = stampVcIds(html);
  assert.equal(stamped.startsWith("<div>plain</div>"), true);
  assert.match(stamped, /<div role="button" data-vc-id="do-it">Do it<\/div>/);
});
