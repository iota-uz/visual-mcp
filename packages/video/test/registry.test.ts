import assert from "node:assert/strict";
import { test } from "node:test";
import {
  builtInCharacterPacks,
  CharacterPack,
  CharacterSceneProps,
  ComponentSource,
  componentResources,
  componentTimingIssues,
  phoneCharacterProp,
} from "../src/registry.js";

function pilot() {
  return {
    background: "#061b36",
    seed: 42,
    characterPacksById: structuredClone(builtInCharacterPacks),
    actorOrder: ["farq", "customer"],
    actorsById: {
      farq: {
        characterPackId: "farq-mascot",
        x: 0.3,
        y: 0.65,
        scale: 1,
        facing: "right",
        initialEmotion: "neutral",
      },
      customer: {
        characterPackId: "customer",
        x: 0.72,
        y: 0.65,
        scale: 1,
        facing: "left",
        initialEmotion: "thinking",
      },
    },
    actionOrder: ["farqEnter", "customerLook", "farqTalk", "customerReact"],
    actionsById: {
      farqEnter: {
        type: "enter",
        actorId: "farq",
        startFrame: 0,
        durationFrames: 18,
        from: "left",
      },
      customerLook: {
        type: "look",
        actorId: "customer",
        startFrame: 18,
        durationFrames: 12,
        target: { kind: "actor", actorId: "farq" },
      },
      farqTalk: {
        type: "talk",
        actorId: "farq",
        startFrame: 30,
        durationFrames: 30,
        emotion: "happy",
        visemes: [
          { frame: 0, shape: "rest" },
          { frame: 6, shape: "a" },
          { frame: 12, shape: "m" },
        ],
      },
      customerReact: {
        type: "react",
        actorId: "customer",
        startFrame: 60,
        durationFrames: 20,
        preset: "shocked",
      },
    },
    overlayOrder: ["price"],
    overlaysById: {
      price: {
        text: "129 000 so'm",
        x: 0.5,
        y: 0.2,
        startFrame: 60,
        endFrame: 110,
        style: "price-new",
      },
    },
    caption: "Farq finds a better price.",
  };
}

test("character-scene accepts serialized character packs and publishes only revision 2", () => {
  const props = CharacterSceneProps.parse(pilot());
  assert.equal(props.actionsById.farqTalk?.type, "talk");
  assert.ok(
    componentResources.some(
      (resource) =>
        resource.resourceId === "video/component/character-scene" &&
        resource.revisionId === "2",
    ),
  );
  assert.equal(
    ComponentSource.safeParse({
      kind: "component",
      component: {
        resourceId: "video/component/character-scene",
        revisionId: "2",
      },
      props,
    }).success,
    true,
  );
  assert.equal(
    ComponentSource.safeParse({
      kind: "component",
      component: {
        resourceId: "video/component/character-scene",
        revisionId: "1",
      },
      props,
    }).success,
    false,
  );
});

test("character-scene rejects unknown references, timing and overlapping owned channels", () => {
  const unknownActor = pilot();
  unknownActor.actionsById.customerLook.target.actorId = "missing";
  assert.equal(CharacterSceneProps.safeParse(unknownActor).success, false);

  const badViseme = pilot();
  badViseme.actionsById.farqTalk.visemes[1]!.frame = 30;
  assert.equal(CharacterSceneProps.safeParse(badViseme).success, false);

  const conflict = pilot();
  conflict.actionOrder = [
    "farqEnter",
    "blinkOne",
    "blinkTwo",
    "farqTalk",
    "customerReact",
  ];
  conflict.actionsById.blinkOne = {
    type: "blink",
    actorId: "farq",
    startFrame: 18,
    durationFrames: 8,
  };
  conflict.actionsById.blinkTwo = {
    type: "blink",
    actorId: "farq",
    startFrame: 22,
    durationFrames: 8,
  };
  assert.equal(CharacterSceneProps.safeParse(conflict).success, false);
});

test("character-scene enforces exact order and rejects non-serializable extras", () => {
  const missingOverlay = pilot();
  missingOverlay.overlayOrder = [];
  assert.equal(CharacterSceneProps.safeParse(missingOverlay).success, false);

  const extra = { ...pilot(), executable: "fetch('https://example.com')" };
  assert.equal(CharacterSceneProps.safeParse(extra).success, false);
});

test("character-scene clip timing checks actions and overlays against its enclosing clip", () => {
  const props = CharacterSceneProps.parse(pilot());
  const source = ComponentSource.parse({
    kind: "component",
    component: {
      resourceId: "video/component/character-scene",
      revisionId: "2",
    },
    props,
  });
  assert.deepEqual(componentTimingIssues(source, [], 120), []);
  assert.deepEqual(
    componentTimingIssues(source, [], 75).map((issue) => issue.path),
    [
      ["source", "props", "actionsById", "customerReact"],
      ["source", "props", "overlaysById", "price"],
    ],
  );
});

test("custom character IDs and different vector geometry use the same scene contract", () => {
  const input = pilot();
  const custom = structuredClone(input.characterPacksById.customer!);
  custom.id = "robot";
  custom.label = "Delivery robot";
  custom.layers = [
    {
      id: "robotHead",
      node: "head",
      shapes: [
        {
          kind: "rect",
          x: -70,
          y: -50,
          width: 140,
          height: 100,
          radius: 8,
          fill: "#2d6977",
          strokeWidth: 0,
        },
      ],
    },
  ];
  input.characterPacksById = { ...input.characterPacksById, robot: custom };
  input.actorsById.customer.characterPackId = "robot";
  const parsed = CharacterSceneProps.parse(JSON.parse(JSON.stringify(input)));
  assert.equal(parsed.actorsById.customer?.characterPackId, "robot");
  assert.equal(
    parsed.characterPacksById.robot?.layers[0]?.shapes[0]?.kind,
    "rect",
  );
});

test("official farq character pins the immutable layered SVG source and rigged derivative", () => {
  const pack = builtInCharacterPacks["farq-official"]!;
  assert.equal(pack.label, "Official farq.uz mascot");
  assert.deepEqual(pack.sourceAsset, {
    assetRef: "asset://shared/farq-official-layered-mascot@1",
    revisionId: "md7chc5vz33an9cd4jw8nm2bg98e9xfd",
    contentHash:
      "e946fed567d9ea44495d218e9cca31249883109031b566a443a7cf8b63e7e4ec",
    mimeType: "image/svg+xml",
  });
  assert.ok(pack.layers.some((layer) => layer.id === "officialPercent"));
  assert.deepEqual(pack.orientation, {
    canonicalFacing: "right",
    mirror: "fixed",
  });
  assert.ok(pack.layers.some((layer) => layer.id === "officialLeftGlove"));
  assert.ok(pack.layers.some((layer) => layer.id === "officialRightGlove"));
  assert.ok(pack.layers.flatMap((layer) => layer.shapes).length >= 38);
  assert.equal(pack.style.handRenderer, "artwork");
  assert.equal(pack.style.eyeHighlightColor, "#ffffff");
  assert.equal(pack.style.tongueColor, "#ff5b18");
  assert.equal(pack.style.handColor, "#ffffff");
});

test("packs validate rig geometry and explicitly gate requested capabilities", () => {
  const broken = structuredClone(builtInCharacterPacks.customer!);
  broken.rig.leftElbow = { ...broken.rig.leftShoulder };
  assert.equal(CharacterPack.safeParse(broken).success, false);
  const input = pilot();
  input.characterPacksById["farq-mascot"]!.capabilities.talk = false;
  assert.equal(CharacterSceneProps.safeParse(input).success, false);
  const missingPack = pilot();
  missingPack.actorsById.customer.characterPackId = "missing";
  assert.equal(CharacterSceneProps.safeParse(missingPack).success, false);
  const wrongId = pilot();
  wrongId.characterPacksById.customer!.id = "notCustomer";
  assert.equal(CharacterSceneProps.safeParse(wrongId).success, false);
});

test("pack artwork remains declarative and rejects executable or external content", () => {
  const input = structuredClone(builtInCharacterPacks.customer!);
  const layer = input.layers[0]!;
  assert.equal(
    CharacterPack.safeParse({ ...input, svg: "<svg onload='alert(1)'/>" })
      .success,
    false,
  );
  assert.equal(
    CharacterPack.safeParse({
      ...input,
      layers: [
        {
          ...layer,
          shapes: [{ kind: "image", href: "https://example.com/asset.svg" }],
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    CharacterPack.safeParse({
      ...input,
      layers: [
        {
          ...layer,
          shapes: [
            { kind: "path", d: "M0 0 <script>bad</script>", fill: "#ffffff" },
          ],
        },
      ],
    }).success,
    false,
  );
});

test("independent arm masks and priority overrides can compose while ambiguous ownership fails", () => {
  const props = CharacterSceneProps.parse(pilot());
  props.actionOrder = ["left", "right", "override"];
  props.actionsById = {
    left: {
      type: "gesture",
      actorId: "farq",
      startFrame: 0,
      durationFrames: 60,
      priority: 0,
      weight: 1,
      blendInFrames: 6,
      blendOutFrames: 6,
      preset: "explain",
      hand: "left",
      intensity: 1,
    },
    right: {
      type: "point",
      actorId: "farq",
      startFrame: 0,
      durationFrames: 60,
      priority: 0,
      weight: 1,
      blendInFrames: 6,
      blendOutFrames: 6,
      target: { kind: "overlay", overlayId: "price" },
      hand: "right",
    },
    override: {
      type: "point",
      actorId: "farq",
      startFrame: 15,
      durationFrames: 15,
      priority: 1,
      weight: 0.5,
      blendInFrames: 6,
      blendOutFrames: 6,
      target: { kind: "point", x: 0.7, y: 0.3 },
      hand: "right",
    },
  };
  assert.equal(CharacterSceneProps.safeParse(props).success, true);
  props.actionsById.override!.priority = 0;
  assert.equal(CharacterSceneProps.safeParse(props).success, false);
  props.actionsById.override!.priority = 1;
  props.actionsById.override!.mask = ["mouth"];
  assert.equal(CharacterSceneProps.safeParse(props).success, false);
});

test("spatial target and attachment references are validated before rendering", () => {
  const props = CharacterSceneProps.parse(pilot());
  props.propOrder = ["phone"];
  props.propsById = {
    phone: {
      ...structuredClone(phoneCharacterProp),
      attachment: {
        actorId: "farq",
        hand: "right",
        offset: { x: 0, y: 0 },
        rotation: 0,
      },
    },
  };
  props.actionOrder = ["show"];
  props.actionsById = {
    show: {
      type: "showProp",
      actorId: "farq",
      propId: "phone",
      hand: "right",
      target: { kind: "actor", actorId: "customer" },
      startFrame: 0,
      durationFrames: 60,
      priority: 0,
      weight: 1,
      blendInFrames: 6,
      blendOutFrames: 6,
    },
  };
  assert.equal(CharacterSceneProps.safeParse(props).success, true);
  props.propsById.phone!.attachment!.actorId = "missing";
  assert.equal(CharacterSceneProps.safeParse(props).success, false);
  props.propsById.phone!.attachment!.actorId = "farq";
  props.actionsById.show = {
    ...props.actionsById.show!,
    target: { kind: "overlay", overlayId: "missing" },
  };
  assert.equal(CharacterSceneProps.safeParse(props).success, false);
});
