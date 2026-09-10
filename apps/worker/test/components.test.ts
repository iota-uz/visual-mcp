import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ComponentSource,
  componentTimingIssues,
  Effect,
  SceneGraphProps,
} from "@visual-canvas/video/registry";
import { animatedValue, effectStyle } from "../src/video/components.js";

test("trusted registry rejects unknown revisions, code props and out-of-clip frames", () => {
  const props = SceneGraphProps.parse({
    background: "#000000",
    nodeOrder: ["shape"],
    nodesById: {
      shape: {
        kind: "shape",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        shape: "rectangle",
        fill: "#ffffff",
        animations: [
          {
            property: "opacity",
            keyframes: [
              { frame: 0, value: 0 },
              { frame: 59, value: 1 },
            ],
          },
        ],
      },
    },
  });
  const source = ComponentSource.parse({
    kind: "component",
    component: { resourceId: "video/component/scene-graph", revisionId: "1" },
    props,
  });
  assert.equal(componentTimingIssues(source, [], 60).length, 0);
  assert.equal(componentTimingIssues(source, [], 59).length, 1);
  assert.equal(
    ComponentSource.safeParse({ ...source, component: { ...source.component, revisionId: "2" } })
      .success,
    false,
  );
  assert.equal(
    ComponentSource.safeParse({ ...source, props: { ...props, jsx: "fetch('/secret')" } }).success,
    false,
  );
  assert.equal(
    Effect.safeParse({
      preset: { resourceId: "untrusted", revisionId: "1" },
      parameters: { inFrames: 2, outFrames: 2 },
    }).success,
    false,
  );
  assert.equal(animatedValue(props.nodesById.shape!.animations[0]!, 29.5), 0.5);
  assert.equal(
    effectStyle(
      [
        Effect.parse({
          preset: { resourceId: "video/effect/fade", revisionId: "1" },
          parameters: { inFrames: 10, outFrames: 10 },
        }),
      ],
      0,
      60,
    ).opacity,
    0,
  );
});
