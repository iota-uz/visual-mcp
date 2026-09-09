import assert from "node:assert/strict";
import test from "node:test";
import {
  clampLocal,
  describeCommentAnchor,
  localFromWorld,
  worldFromCommentAnchor,
} from "../src/comment-anchor.js";

const node = { x: 100, y: 50, w: 200, h: 100 };

test("clampLocal folds out-of-range and non-finite into 0–1", () => {
  assert.deepEqual(clampLocal({ x: -1, y: 2 }), { x: 0, y: 1 });
  assert.deepEqual(clampLocal({ x: Number.NaN, y: Number.POSITIVE_INFINITY }), { x: 0, y: 1 });
});

test("localFromWorld is the inverse of worldFromCommentAnchor for a local pin", () => {
  const local = localFromWorld(node, { x: 150, y: 100 });
  assert.deepEqual(local, { x: 0.25, y: 0.5 });
  assert.deepEqual(worldFromCommentAnchor(node, { nodeId: "n", local }), { x: 150, y: 100 });
});

test("a node comment without local sits at the top-right", () => {
  assert.deepEqual(worldFromCommentAnchor(node, { nodeId: "n" }), { x: 300, y: 50 });
});

test("a missing node with a nodeId does not paint", () => {
  assert.equal(
    worldFromCommentAnchor(undefined, { nodeId: "gone", local: { x: 0.5, y: 0.5 } }),
    null,
  );
});

test("a page comment sits on its world point", () => {
  assert.deepEqual(worldFromCommentAnchor(undefined, { point: { x: 9, y: 8 } }), { x: 9, y: 8 });
});

test("describeCommentAnchor is a sentence an agent can read", () => {
  assert.equal(
    describeCommentAnchor({
      nodeId: "intake",
      nodeTitle: "Invite",
      el: "submit-claim",
      role: "button",
      name: "Submit claim",
      local: { x: 0.25, y: 0.8 },
    }),
    "On Invite · Submit claim (button)",
  );
  assert.equal(
    describeCommentAnchor({ nodeId: "intake", nodeTitle: "Invite", local: { x: 0.25, y: 0.8 } }),
    "On Invite, 25% from the left, 80% from the top",
  );
  assert.equal(
    describeCommentAnchor({ nodeId: "intake", nodeTitle: "Invite" }),
    "On Invite (whole frame)",
  );
  assert.equal(
    describeCommentAnchor({ point: { x: 640.4, y: 120.6 } }),
    "On the page at (640, 121)",
  );
});
