import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CharacterSceneProps } from "../src/character.js";
import {
  canonicalActionDefinition,
  createProjectActionLibrary,
  expandActionReference,
  promoteActionLibraryToShared,
} from "../src/character-action-library.js";
import { choreography, compileCharacterChoreography } from "../src/character-choreography.js";
import {
  migrateCharacterScene,
  migrateCharacterSceneRevision3To4,
} from "../src/character-migrations.js";
import { builtInCharacterPacks } from "../src/character-packs.js";
import { bakeProceduralAction, compileProceduralExpression } from "../src/character-procedural.js";

const revisionId = "a".repeat(64);
const blink = { type: "blink" as const };

test("seconds choreography resolves at/after/with/hold deterministically", () => {
  const compiled = choreography({ numerator: 30, denominator: 1 })
    .at(1)
    .do("first", "Farq", 0.5, blink)
    .hold(0.25)
    .after("first", 0.1)
    .do("second", "Farq", 0.2, blink)
    .with("first", 0.2)
    .do("parallel", "Farq", 0.1, blink)
    .compile();
  assert.deepEqual(compiled.actionOrder, ["first", "parallel", "second"]);
  assert.deepEqual(
    [compiled.actionsById.first!.startFrame, compiled.actionsById.first!.durationFrames],
    [30, 15],
  );
  assert.equal(compiled.actionsById.parallel!.startFrame, 36);
  assert.equal(compiled.actionsById.second!.startFrame, 56);
});

test("relative choreography rejects cycles and missing anchors", () => {
  const base = { actorId: "Farq", durationSeconds: 1, holdSeconds: 0, action: blink };
  assert.throws(
    () =>
      compileCharacterChoreography({
        timebase: { numerator: 30, denominator: 1 },
        steps: [
          { ...base, id: "a", placement: { kind: "after", id: "b", seconds: 0 } },
          { ...base, id: "b", placement: { kind: "with", id: "a", seconds: 0 } },
        ],
      }),
    /cycle/,
  );
  assert.throws(
    () =>
      compileCharacterChoreography({
        timebase: { numerator: 30, denominator: 1 },
        steps: [{ ...base, id: "a", placement: { kind: "after", id: "missing", seconds: 0 } }],
      }),
    /Unknown relative action/,
  );
});

test("action snapshots are immutable, explicitly promoted, and revision-frozen", () => {
  const project = createProjectActionLibrary([
    {
      id: "blink",
      revisionId,
      label: "Blink",
      content: { kind: "single", durationSeconds: 0.2, action: blink },
    },
  ]);
  assert.equal(project.scope, "project");
  assert.throws(() => {
    (project.definitions.blink as { label: string }).label = "changed";
  }, TypeError);
  const shared = promoteActionLibraryToShared(project);
  assert.equal(shared.scope, "shared");
  assert.deepEqual(expandActionReference(shared, { id: "blink", revisionId }), {
    kind: "single",
    durationSeconds: 0.2,
    action: blink,
  });
  assert.throws(
    () => expandActionReference(shared, { id: "blink", revisionId: "b".repeat(64) }),
    /revision mismatch/,
  );
  assert.equal(
    canonicalActionDefinition({
      id: "blink",
      label: "Blink",
      content: { kind: "single", durationSeconds: 0.2, action: blink },
    }),
    '{"content":{"action":{"type":"blink"},"durationSeconds":0.2,"kind":"single"},"id":"blink","label":"Blink"}',
  );
});

test("compound references expand frozen relative seconds with self actor binding", () => {
  const library = createProjectActionLibrary([
    {
      id: "double",
      revisionId,
      label: "Double blink",
      content: {
        kind: "sequence",
        durationSeconds: 1,
        actions: [
          { id: "first", atSeconds: 0, durationSeconds: 0.1, action: blink },
          { id: "second", atSeconds: 0.5, durationSeconds: 0.2, action: blink },
        ],
      },
    },
  ]);
  const compiled = choreography({ numerator: 30, denominator: 1 }, library)
    .at(2)
    .use("reaction", "Customer", { id: "double", revisionId })
    .hold(0.25)
    .after("reaction")
    .do("next", "Customer", 0.1, blink)
    .compile();
  assert.deepEqual(compiled.actionOrder, ["reaction-first", "reaction-second", "next"]);
  assert.deepEqual(
    [
      compiled.actionsById["reaction-first"]!.actorId,
      compiled.actionsById["reaction-first"]!.startFrame,
    ],
    ["Customer", 60],
  );
  assert.equal(compiled.actionsById["reaction-second"]!.startFrame, 75);
  assert.equal(compiled.actionsById.next!.startFrame, 98);
  assert.doesNotThrow(() =>
    CharacterSceneProps.parse({
      stage: { aspect: "9:16", width: 1080, height: 1920 },
      timebase: compiled.timebase,
      seed: 1,
      staging: { layout: "reaction-closeup", focalActorId: "Customer" },
      camera: { movement: "locked", startFrame: 0, durationFrames: 120 },
      cameraSequence: [],
      effects: [],
      environment: {
        background: "#000000",
        horizonY: 0.6,
        ground: "#111111",
        accent: "#ffffff",
        layers: [],
      },
      characterPacksById: { customer: builtInCharacterPacks.customer },
      actorOrder: ["Customer"],
      actorsById: {
        Customer: {
          characterPackId: "customer",
          x: 0.5,
          y: 0.6,
          scale: 1,
          facing: "right",
          initialEmotion: "neutral",
        },
      },
      propOrder: [],
      propsById: {},
      actionOrder: compiled.actionOrder,
      actionsById: compiled.actionsById,
      overlayOrder: [],
      overlaysById: {},
    }),
  );
});

test("compound expansion rejects invalid or colliding generated IDs without truncation", () => {
  const library = createProjectActionLibrary([
    {
      id: "pair",
      revisionId,
      label: "Pair",
      content: {
        kind: "sequence",
        durationSeconds: 1,
        actions: [{ id: "child", atSeconds: 0, durationSeconds: 0.1, action: blink }],
      },
    },
  ]);
  assert.throws(
    () =>
      choreography({ numerator: 30, denominator: 1 }, library)
        .at(0)
        .use("x".repeat(63), "Actor", { id: "pair", revisionId })
        .compile(),
    /ID is invalid/,
  );
  assert.throws(
    () =>
      choreography({ numerator: 30, denominator: 1 }, library)
        .at(0)
        .use("same", "Actor", { id: "pair", revisionId })
        .at(1)
        .do("same-child", "Actor", 0.1, blink)
        .compile(),
    /collides/,
  );
});

test("procedural authoring compiles a small expression AST and bakes deterministic tracks", () => {
  const input = {
    source: '(t,ctx)=>({"root.x": lerp(0, 1, t), "head.rotation": noise(t,ctx)})',
    actorId: "Farq",
    startFrame: 12,
    durationFrames: 90,
    timebase: { numerator: 30, denominator: 1 },
    seed: 42,
  };
  const first = bakeProceduralAction(input),
    second = bakeProceduralAction(input);
  assert.deepEqual(first, second);
  assert.equal(first.type, "animate");
  if (first.type === "animate") {
    assert.equal(first.tracks.length, 2);
    assert.equal(first.tracks[0]!.keyframes.length, 64);
    assert.equal(first.tracks[0]!.keyframes.at(-1)!.frame, 89);
  }
});

test("procedural escape hatch rejects property access, globals, statements, and bad numeric output", () => {
  for (const source of [
    '(t,ctx)=>({"root.x": globalThis.fetch(t)})',
    '(t,ctx)=>({"root.x": Math.random()})',
    '(t,ctx)=>{ return {"root.x": t}; }',
    '(t,ctx)=>({["root.x"]: t})',
    '(t,ctx)=>({"root.x": (()=>1)()})',
  ])
    assert.throws(
      () => compileProceduralExpression(source),
      /not allowed|object literal|static channel/,
    );
  assert.throws(
    () =>
      bakeProceduralAction({
        source: '(t,ctx)=>({"root.x": 1/0})',
        actorId: "Farq",
        startFrame: 0,
        durationFrames: 2,
        timebase: { numerator: 30, denominator: 1 },
        seed: 1,
      }),
    /invalid value/,
  );
  assert.throws(
    () => compileProceduralExpression('(t,ctx)=>({"root.x": secret+t})'),
    /Identifier is not allowed/,
  );
  assert.throws(
    () =>
      compileProceduralExpression(`(t,ctx)=>({"root.x": ${"-(".repeat(20)}t${")".repeat(20)}})`),
    /depth/,
  );
  assert.throws(
    () =>
      compileProceduralExpression(
        `(t,ctx)=>({"root.x": ${Array.from({ length: 260 }, () => "t").join("+")}})`,
      ),
    /AST nodes|depth/,
  );
  assert.throws(
    () =>
      bakeProceduralAction({
        source: '(t,ctx)=>({"root.x": sqrt(-1)})',
        actorId: "Farq",
        startFrame: 0,
        durationFrames: 2,
        timebase: { numerator: 30, denominator: 1 },
        seed: 1,
      }),
    /invalid value/,
  );
});

test("revision 3 to 4 migration is pure, preserves authored data, and rejects unknown revisions", () => {
  const props = {
    timebase: { numerator: 30000, denominator: 1001 },
    characterPacksById: { farq: { sourceAsset: "asset://shared/farq@2" } },
    actionsById: { wave: { type: "gesture" } },
  };
  const old = { revision: "3" as const, props };
  const migrated = migrateCharacterSceneRevision3To4(old);
  assert.equal(migrated.revision, "4");
  assert.deepEqual(migrated.props.timebase, props.timebase);
  assert.deepEqual(migrated.props.actionsById, props.actionsById);
  assert.notEqual(migrated.props, props);
  assert.equal(old.revision, "3");
  assert.throws(() => migrateCharacterScene({ revision: "2", props: {} }), /No explicit/);
  assert.throws(() => migrateCharacterScene({ revision: "4", props: {} }), /No explicit/);
});

test("migration upgrades the genuine saved revision-3 pilot without changing artwork, assets, actions or timebase", () => {
  const props = JSON.parse(
    readFileSync(new URL("./fixtures/character-scene-v3.json", import.meta.url), "utf8"),
  );
  const original = structuredClone(props);
  const migrated = migrateCharacterSceneRevision3To4({ revision: "3", props });
  assert.deepEqual(migrated.props.stage, { aspect: "9:16", width: 1080, height: 1920 });
  assert.deepEqual(migrated.props.cameraSequence, []);
  assert.deepEqual(migrated.props.effects, []);
  const next = migrated.props as typeof original;
  assert.deepEqual(next.timebase, original.timebase);
  assert.deepEqual(next.actionsById, original.actionsById);
  for (const id of Object.keys(original.characterPacksById)) {
    assert.deepEqual(next.characterPacksById[id].layers, original.characterPacksById[id].layers);
    assert.deepEqual(
      next.characterPacksById[id].sourceAsset,
      original.characterPacksById[id].sourceAsset,
    );
    assert.deepEqual(
      next.characterPacksById[id].capabilities,
      original.characterPacksById[id].capabilities,
    );
    assert.deepEqual(
      next.characterPacksById[id].expressions.sad,
      original.characterPacksById[id].expressions.neutral,
    );
  }
  assert.doesNotThrow(() => CharacterSceneProps.parse(migrated.props));
  assert.deepEqual(props, original);
});
