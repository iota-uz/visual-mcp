import type { CharacterAction } from "../../../../../packages/video/src/character";
import { stageCharacterActors } from "../../../../../packages/video/src/character-staging";
import {
  builtInCharacterPacks,
  CharacterSceneProps,
  compileCharacterActing,
  phoneCharacterProp,
} from "../../../../../packages/video/src/registry";

type CharacterGestureName = Extract<CharacterAction, { type: "gesture" }>["preset"];
type CharacterReactionName = Extract<CharacterAction, { type: "react" }>["preset"];
const gestureNames = builtInCharacterPacks["farq-official"]!.capabilities.gestures;
const reactionNames = builtInCharacterPacks["farq-official"]!.capabilities.emotions.filter(
  (emotion): emotion is CharacterReactionName => emotion !== "neutral",
);

export const LAB_FPS = 30;

export type LabTuning = {
  durationFrames: number;
  blendInFrames: number;
  blendOutFrames: number;
  intensity: number;
};

export const defaultLabTuning: LabTuning = {
  durationFrames: 60,
  blendInFrames: 8,
  blendOutFrames: 10,
  intensity: 0.9,
};

const officialFarqPack = builtInCharacterPacks["farq-official"];
if (!officialFarqPack) throw new Error("The official Farq character pack is not registered");

export type ScenarioId =
  | "golden-ad"
  | "golden-ad-raw"
  | "golden-ad-camera-off"
  | "golden-ad-customer"
  | "idle"
  | "enter"
  | "blink"
  | "look"
  | "talk"
  | `gesture-${CharacterGestureName}`
  | `react-${CharacterReactionName}`
  | "point"
  | "show-prop"
  | "idle-look-talk"
  | "enter-explain"
  | "show-prop-point"
  | "react-settle"
  | "gesture-matrix"
  | "emotion-matrix"
  | "camera-matrix"
  | "effect-matrix"
  | "stage-landscape"
  | "stage-square"
  | "new-customer"
  | "compound-procedural";

export type ScenarioPhase = {
  frame: number;
  label: string;
  tone?: "neutral" | "action" | "transition";
};

export type CharacterLabScenario = {
  id: ScenarioId;
  label: string;
  group: "Advertising" | "Foundation" | "Gesture" | "Reaction" | "Targeting" | "Transitions";
  description: string;
  totalFrames: number;
  phases: ScenarioPhase[];
  props: CharacterSceneProps;
};

export const scenarioCatalog: ReadonlyArray<
  Pick<CharacterLabScenario, "id" | "label" | "group" | "description">
> = [
  {
    id: "golden-ad",
    label: "Golden ad · compiled",
    group: "Advertising",
    description: "Notice, explain, product contact, offer point and reaction with authored camera.",
  },
  {
    id: "golden-ad-raw",
    label: "Golden ad · raw",
    group: "Advertising",
    description: "The same staging and beats without compiled acting phase metadata.",
  },
  {
    id: "golden-ad-camera-off",
    label: "Golden ad · camera off",
    group: "Advertising",
    description: "The compiled performance with only the camera treatment isolated.",
  },
  {
    id: "golden-ad-customer",
    label: "Golden ad · second pack",
    group: "Advertising",
    description: "Identical compiled choreography performed by the customer character pack.",
  },
  {
    id: "idle",
    label: "Idle",
    group: "Foundation",
    description: "Seeded breathing, sway and automatic blink cadence.",
  },
  {
    id: "enter",
    label: "Enter",
    group: "Foundation",
    description: "Off-stage entrance with opacity and positional settling.",
  },
  {
    id: "blink",
    label: "Blink",
    group: "Foundation",
    description: "Explicit eye-channel blink with editable easing windows.",
  },
  {
    id: "look",
    label: "Look",
    group: "Foundation",
    description: "Head and gaze tracking toward a spatial target.",
  },
  {
    id: "talk",
    label: "Talk / visemes",
    group: "Foundation",
    description: "Authored mouth shapes with an emotional performance layer.",
  },
  {
    id: "gesture-point",
    label: "Gesture · Point",
    group: "Gesture",
    description: "Preset point performance on both arms.",
  },
  {
    id: "gesture-explain",
    label: "Gesture · Explain",
    group: "Gesture",
    description: "Open explanatory arm motion.",
  },
  {
    id: "gesture-shrug",
    label: "Gesture · Shrug",
    group: "Gesture",
    description: "Symmetric shrug performance.",
  },
  {
    id: "gesture-think",
    label: "Gesture · Think",
    group: "Gesture",
    description: "Single-hand thinking pose.",
  },
  {
    id: "react-happy",
    label: "React · Happy",
    group: "Reaction",
    description: "Body and expression response: happy.",
  },
  {
    id: "react-shocked",
    label: "React · Shocked",
    group: "Reaction",
    description: "Body and expression response: shocked.",
  },
  {
    id: "react-thinking",
    label: "React · Thinking",
    group: "Reaction",
    description: "Body and expression response: thinking.",
  },
  {
    id: "point",
    label: "Point at target",
    group: "Targeting",
    description: "IK point at a normalized stage coordinate.",
  },
  {
    id: "show-prop",
    label: "Show prop",
    group: "Targeting",
    description: "Reveal, attach and hold the production phone prop.",
  },
  {
    id: "idle-look-talk",
    label: "Idle → Look → Talk",
    group: "Transitions",
    description: "A natural attention shift into dialogue.",
  },
  {
    id: "enter-explain",
    label: "Enter → Explain",
    group: "Transitions",
    description: "Entrance momentum handed off to an explain gesture.",
  },
  {
    id: "show-prop-point",
    label: "Show prop → Point",
    group: "Transitions",
    description: "Persistent prop attachment followed by opposite-hand targeting.",
  },
  {
    id: "react-settle",
    label: "React → Settle",
    group: "Transitions",
    description: "Strong reaction with a visible blend back to idle.",
  },
  {
    id: "gesture-matrix",
    label: "All gestures",
    group: "Gesture",
    description: "Sequential visual inventory of every reusable gesture preset.",
  },
  {
    id: "emotion-matrix",
    label: "All emotions",
    group: "Reaction",
    description: "Sequential visual inventory of every non-neutral emotion.",
  },
  {
    id: "camera-matrix",
    label: "All camera moves",
    group: "Advertising",
    description: "Cut, frame, pan, push, pull, follow, shake and hold in one sequence.",
  },
  {
    id: "effect-matrix",
    label: "All effects",
    group: "Advertising",
    description: "Particles, smoke, impact, speed-lines and highlight as seeded renderer data.",
  },
  {
    id: "stage-landscape",
    label: "Stage · 16:9",
    group: "Foundation",
    description: "Real landscape scene geometry.",
  },
  {
    id: "stage-square",
    label: "Stage · 1:1",
    group: "Foundation",
    description: "Real square scene geometry.",
  },
  {
    id: "new-customer",
    label: "Energetic customer",
    group: "Foundation",
    description: "The second generic customer pack using the same renderer.",
  },
  {
    id: "compound-procedural",
    label: "Compound + procedural",
    group: "Transitions",
    description: "Reusable compound performance with a baked numeric animate action.",
  },
];

const clone = <T>(value: T): T => structuredClone(value);
const boundedTuning = (value: LabTuning): LabTuning => ({
  durationFrames: Math.max(8, Math.min(300, Math.round(value.durationFrames))),
  blendInFrames: Math.max(0, Math.min(60, Math.round(value.blendInFrames))),
  blendOutFrames: Math.max(0, Math.min(60, Math.round(value.blendOutFrames))),
  intensity: Math.max(0, Math.min(1, value.intensity)),
});

function actionBase(startFrame: number, tuning: LabTuning) {
  return {
    actorId: "farq",
    startFrame,
    durationFrames: tuning.durationFrames,
    blendInFrames: Math.min(tuning.blendInFrames, tuning.durationFrames),
    blendOutFrames: Math.min(tuning.blendOutFrames, tuning.durationFrames),
    weight: 1,
    priority: 0,
  };
}

function baseScene() {
  return CharacterSceneProps.parse({
    stage: { aspect: "9:16", width: 1080, height: 1920 },
    timebase: { numerator: 30, denominator: 1 },
    seed: 20260912,
    staging: { layout: "single-product" as const, focalActorId: "farq" },
    camera: { movement: "locked" as const, startFrame: 0, durationFrames: 72000 },
    environment: {
      background: "#120d0a",
      horizonY: 0.64,
      ground: "#251611",
      accent: "#ffb52e",
      layers: [],
    },
    characterPacksById: {
      "farq-official": clone(officialFarqPack),
    },
    actorOrder: ["farq"],
    actorsById: {
      farq: {
        characterPackId: "farq-official",
        x: 0.5,
        y: 0.63,
        scale: 1.55,
        facing: "right" as const,
        initialEmotion: "neutral" as const,
      },
    },
    propOrder: [] as string[],
    propsById: {},
    actionOrder: [] as string[],
    actionsById: {} as Record<string, CharacterAction>,
    overlayOrder: [] as string[],
    overlaysById: {},
    caption: "Farq character animation lab",
  });
}

function finalize(
  id: ScenarioId,
  totalFrames: number,
  phases: ScenarioPhase[],
  scene: ReturnType<typeof baseScene>,
): CharacterLabScenario {
  const item = scenarioCatalog.find((entry) => entry.id === id);
  if (!item) throw new Error(`Unknown character lab scenario: ${id}`);
  return {
    ...item,
    totalFrames,
    phases,
    props: CharacterSceneProps.parse(scene),
  };
}

function addAction(scene: ReturnType<typeof baseScene>, id: string, action: CharacterAction) {
  scene.actionOrder.push(id);
  scene.actionsById[id] = action;
}

function addPhone(scene: ReturnType<typeof baseScene>) {
  const phone = clone(phoneCharacterProp);
  scene.propOrder.push("phone");
  (scene.propsById as Record<string, typeof phone>).phone = phone;
}

export function buildCharacterScenario(
  id: ScenarioId,
  inputTuning: LabTuning = defaultLabTuning,
): CharacterLabScenario {
  const tuning = boundedTuning(inputTuning),
    scene = baseScene(),
    start = 18,
    end = start + tuning.durationFrames,
    phases: ScenarioPhase[] = [{ frame: 0, label: "idle", tone: "neutral" }];

  if (id.startsWith("golden-ad")) {
    addPhone(scene);
    const phone = scene.propsById.phone;
    if (!phone) throw new Error("Golden advertising scene requires its phone prop");
    phone.initiallyVisible = true;
    phone.x = 0.64;
    phone.y = 0.73;
    scene.environment.horizonY = 0.9;
    scene.environment.layers.push({
      id: "productPlinth",
      plane: "midground",
      shape: "panel",
      x: 0.64,
      y: 0.79,
      width: 0.24,
      height: 0.08,
      color: "#f7ead8",
      opacity: 1,
      parallax: 0.08,
    });
    scene.staging = { layout: "single-product", focalActorId: "farq", productPropId: "phone" };
    scene.camera = {
      movement: id === "golden-ad-camera-off" ? "locked" : "push-in",
      startFrame: 118,
      durationFrames: 18,
      holdFrames: 0,
      intensity: 0.32,
    };
    scene.overlayOrder.push("oldPrice", "newPrice", "offer", "cta");
    Object.assign(scene.overlaysById, {
      oldPrice: {
        text: "158,000 UZS",
        x: 0.28,
        y: 0.12,
        startFrame: 106,
        endFrame: 178,
        style: "price-old",
        accent: "#9aa7b6",
      },
      newPrice: {
        text: "129,000 UZS",
        x: 0.72,
        y: 0.22,
        startFrame: 118,
        endFrame: 205,
        style: "price-new",
        accent: "#ffb52e",
      },
      offer: {
        text: "Save 18%",
        emphasis: "18% less",
        x: 0.5,
        y: 0.36,
        startFrame: 118,
        endFrame: 205,
        style: "savings",
        accent: "#ffb52e",
      },
      cta: {
        text: "Compare before you buy",
        x: 0.5,
        y: 0.88,
        startFrame: 178,
        endFrame: 238,
        style: "cta",
        accent: "#ffb52e",
      },
    });
    if (id === "golden-ad-customer") {
      const customer = builtInCharacterPacks.customer;
      const actor = scene.actorsById.farq;
      if (!customer || !actor) throw new Error("Golden second-pack scene requires customer data");
      scene.characterPacksById = { customer: clone(customer) };
      actor.characterPackId = "customer";
      actor.scale = 1.25;
    }
    scene.actorsById = stageCharacterActors({
      layout: scene.staging.layout,
      actorOrder: scene.actorOrder,
      actorsById: scene.actorsById,
      characterPacksById: scene.characterPacksById,
      focalActorId: scene.staging.focalActorId,
    });
    const compiled = compileCharacterActing({
      timebase: scene.timebase,
      beats: [
        {
          id: "notice",
          type: "notice",
          actorId: "farq",
          startFrame: 12,
          durationFrames: 36,
          target: { kind: "prop", propId: "phone" },
          emotion: "thinking",
        },
        {
          id: "explain",
          type: "explain",
          actorId: "farq",
          startFrame: 48,
          durationFrames: 42,
          target: { kind: "camera" },
          hand: "both",
          emotion: "happy",
        },
        {
          id: "pickup",
          type: "show_prop",
          actorId: "farq",
          startFrame: 90,
          durationFrames: 42,
          propId: "phone",
          hand: "right",
          interaction: "pickUp",
          target: { kind: "prop", propId: "phone" },
        },
        {
          id: "offer",
          type: "point",
          actorId: "farq",
          startFrame: 132,
          durationFrames: 42,
          target: { kind: "overlay", overlayId: "offer" },
          hand: "left",
          emotion: "happy",
        },
        {
          id: "place",
          type: "show_prop",
          actorId: "farq",
          startFrame: 174,
          durationFrames: 30,
          propId: "phone",
          hand: "right",
          interaction: "place",
          target: { kind: "point", x: 0.5, y: 0.72 },
        },
        {
          id: "close",
          type: "react",
          actorId: "farq",
          startFrame: 204,
          durationFrames: 34,
          emotion: "happy",
          target: { kind: "camera" },
        },
      ],
    });
    scene.actionOrder = compiled.actionOrder;
    scene.actionsById = compiled.actionsById;
    if (id === "golden-ad-raw")
      for (const action of Object.values(scene.actionsById)) delete action.acting;
    phases.push(
      { frame: 12, label: "notice", tone: "action" },
      { frame: 48, label: "explain", tone: "transition" },
      { frame: 90, label: "pick up", tone: "action" },
      { frame: 132, label: "offer", tone: "action" },
      { frame: 174, label: "place", tone: "transition" },
      { frame: 204, label: "close", tone: "action" },
    );
    return finalize(id, 240, phases, scene);
  }

  if (id === "gesture-matrix") {
    gestureNames.forEach((preset, index) => {
      const at = 12 + index * 34;
      addAction(scene, `gesture${index}`, {
        type: "gesture",
        ...actionBase(at, { ...tuning, durationFrames: 30, blendInFrames: 4, blendOutFrames: 4 }),
        preset,
        hand: preset === "think" || preset === "facepalm" ? "right" : "both",
        intensity: tuning.intensity,
      });
      phases.push({ frame: at, label: preset, tone: "action" });
    });
    return finalize(id, 12 + gestureNames.length * 34 + 20, phases, scene);
  }
  if (id === "emotion-matrix") {
    reactionNames.forEach((preset, index) => {
      const at = 12 + index * 38;
      addAction(scene, `emotion${index}`, {
        type: "react",
        ...actionBase(at, { ...tuning, durationFrames: 34, blendInFrames: 5, blendOutFrames: 5 }),
        preset,
        intensity: tuning.intensity,
      });
      phases.push({ frame: at, label: preset, tone: "action" });
    });
    return finalize(id, 12 + reactionNames.length * 38 + 20, phases, scene);
  }
  if (id === "camera-matrix") {
    const types = ["cut", "frame", "pan", "push", "pull", "follow", "shake", "hold"] as const;
    scene.cameraSequence = types.map((type, index) => ({
      id: `camera${index}`,
      type,
      startFrame: index * 36,
      durationFrames: 36,
      target: type === "follow" ? { kind: "actor" as const, actorId: "farq" } : undefined,
      x: index % 2 ? 0.62 : 0.38,
      y: 0.55,
      zoom: type === "push" ? 1.35 : type === "pull" ? 0.8 : 1,
      intensity: 0.7,
      seed: 17,
    }));
    types.forEach((type, index) => {
      phases.push({ frame: index * 36, label: type, tone: "action" });
    });
    return finalize(id, types.length * 36, phases, scene);
  }
  if (id === "effect-matrix") {
    const types = ["particles", "smoke", "impact", "speed-lines", "highlight"] as const;
    scene.effects = types.map((type, index) => ({
      id: `effect${index}`,
      type,
      startFrame: index * 42,
      durationFrames: 38,
      x: 0.5,
      y: 0.38,
      color: ["#ffca3a", "#e2e8f0", "#ff595e", "#60a5fa", "#a78bfa"][index],
      intensity: 0.9,
      count: 18,
      seed: 100 + index,
    }));
    types.forEach((type, index) => {
      phases.push({ frame: index * 42, label: type, tone: "action" });
    });
    return finalize(id, types.length * 42, phases, scene);
  }
  if (id === "stage-landscape" || id === "stage-square") {
    scene.stage =
      id === "stage-landscape"
        ? { aspect: "16:9", width: 1920, height: 1080 }
        : { aspect: "1:1", width: 1080, height: 1080 };
    addAction(scene, "wave", {
      type: "gesture",
      ...actionBase(start, tuning),
      preset: "wave",
      hand: "right",
      intensity: tuning.intensity,
    });
    return finalize(id, end + 30, phases, scene);
  }
  if (id === "new-customer") {
    const pack = builtInCharacterPacks["customer-energetic"]!;
    scene.characterPacksById = { [pack.id]: clone(pack) };
    scene.actorsById.farq!.characterPackId = pack.id;
    scene.actorsById.farq!.scale = 1.35;
    addAction(scene, "celebrate", {
      type: "gesture",
      ...actionBase(start, tuning),
      preset: "celebrate",
      hand: "both",
      intensity: tuning.intensity,
    });
    return finalize(id, end + 30, phases, scene);
  }
  if (id === "compound-procedural") {
    addAction(scene, "greet", {
      type: "gesture",
      ...actionBase(12, { ...tuning, durationFrames: 42 }),
      preset: "greet",
      hand: "right",
      intensity: tuning.intensity,
    });
    addAction(scene, "look", {
      type: "look",
      ...actionBase(58, { ...tuning, durationFrames: 36 }),
      target: { kind: "point", x: 0.78, y: 0.28 },
    });
    addAction(scene, "procedural", {
      type: "animate",
      ...actionBase(98, { ...tuning, durationFrames: 64 }),
      tracks: [
        {
          node: "head",
          property: "rotation",
          mode: "additive",
          keyframes: [
            { frame: 0, value: 0, easing: "smooth" },
            { frame: 16, value: 9, easing: "smooth" },
            { frame: 32, value: -7, easing: "smooth" },
            { frame: 48, value: 5, easing: "smooth" },
            { frame: 63, value: 0, easing: "smooth" },
          ],
        },
        {
          node: "body",
          property: "scaleY",
          mode: "additive",
          keyframes: [
            { frame: 0, value: 0, easing: "smooth" },
            { frame: 20, value: 0.07, easing: "smooth" },
            { frame: 42, value: -0.04, easing: "smooth" },
            { frame: 63, value: 0, easing: "smooth" },
          ],
        },
      ],
    });
    phases.push(
      { frame: 12, label: "compound greet", tone: "action" },
      { frame: 58, label: "compound look", tone: "transition" },
      { frame: 98, label: "baked procedural tracks", tone: "action" },
    );
    return finalize(id, 186, phases, scene);
  }

  if (id === "idle") return finalize(id, tuning.durationFrames + 30, phases, scene);

  if (id === "enter") {
    addAction(scene, "enter", { type: "enter", ...actionBase(start, tuning), from: "left" });
  } else if (id === "blink") {
    const blinkTuning = {
      ...tuning,
      durationFrames: Math.max(8, Math.min(20, tuning.durationFrames)),
    };
    addAction(scene, "blink", { type: "blink", ...actionBase(start, blinkTuning) });
  } else if (id === "look") {
    addAction(scene, "look", {
      type: "look",
      ...actionBase(start, tuning),
      target: { kind: "point", x: 0.82, y: 0.25 },
    });
  } else if (id === "talk") {
    const duration = tuning.durationFrames;
    addAction(scene, "talk", {
      type: "talk",
      ...actionBase(start, tuning),
      emotion: "happy",
      visemes: [
        { frame: 0, shape: "m" },
        { frame: Math.max(1, Math.floor(duration * 0.14)), shape: "a" },
        { frame: Math.max(2, Math.floor(duration * 0.34)), shape: "e" },
        { frame: Math.max(3, Math.floor(duration * 0.55)), shape: "o" },
        { frame: Math.max(4, Math.floor(duration * 0.74)), shape: "u" },
        { frame: duration - 1, shape: "m" },
      ],
    });
  } else if (id.startsWith("gesture-")) {
    const preset = id.slice("gesture-".length) as CharacterGestureName;
    addAction(scene, "gesture", {
      type: "gesture",
      ...actionBase(start, tuning),
      preset,
      hand: preset === "think" ? "right" : "both",
      intensity: tuning.intensity,
    });
  } else if (id.startsWith("react-") && id !== "react-settle") {
    const preset = id.slice("react-".length) as CharacterReactionName;
    addAction(scene, "react", {
      type: "react",
      ...actionBase(start, tuning),
      preset,
      intensity: tuning.intensity,
    });
  } else if (id === "point") {
    addAction(scene, "point", {
      type: "point",
      ...actionBase(start, tuning),
      target: { kind: "point", x: 0.82, y: 0.3 },
      hand: "right",
    });
  } else if (id === "show-prop") {
    addPhone(scene);
    addAction(scene, "showProp", {
      type: "showProp",
      interaction: "reveal",
      ...actionBase(start, tuning),
      propId: "phone",
      hand: "right",
      target: { kind: "camera" },
    });
  } else if (id === "idle-look-talk") {
    const secondStart = end + 8;
    addAction(scene, "look", {
      type: "look",
      ...actionBase(start, tuning),
      target: { kind: "point", x: 0.78, y: 0.3 },
    });
    addAction(scene, "talk", {
      type: "talk",
      ...actionBase(secondStart, tuning),
      emotion: "happy",
      visemes: [
        { frame: 0, shape: "m" },
        { frame: Math.floor(tuning.durationFrames * 0.22), shape: "a" },
        { frame: Math.floor(tuning.durationFrames * 0.5), shape: "o" },
        { frame: tuning.durationFrames - 1, shape: "m" },
      ],
    });
    phases.push(
      { frame: start, label: "look", tone: "action" },
      { frame: secondStart, label: "talk", tone: "transition" },
    );
    return finalize(id, secondStart + tuning.durationFrames + 24, phases, scene);
  } else if (id === "enter-explain") {
    const secondStart = end + 2;
    addAction(scene, "enter", { type: "enter", ...actionBase(start, tuning), from: "left" });
    addAction(scene, "explain", {
      type: "gesture",
      ...actionBase(secondStart, tuning),
      preset: "explain",
      hand: "both",
      intensity: tuning.intensity,
    });
    phases.push(
      { frame: start, label: "enter", tone: "action" },
      { frame: secondStart, label: "explain", tone: "transition" },
    );
    return finalize(id, secondStart + tuning.durationFrames + 24, phases, scene);
  } else if (id === "show-prop-point") {
    const secondStart = end + 2;
    addPhone(scene);
    addAction(scene, "showProp", {
      type: "showProp",
      interaction: "reveal",
      ...actionBase(start, tuning),
      propId: "phone",
      hand: "right",
      target: { kind: "camera" },
    });
    addAction(scene, "point", {
      type: "point",
      ...actionBase(secondStart, tuning),
      target: { kind: "point", x: 0.18, y: 0.27 },
      hand: "left",
    });
    phases.push(
      { frame: start, label: "show prop", tone: "action" },
      { frame: secondStart, label: "point", tone: "transition" },
    );
    return finalize(id, secondStart + tuning.durationFrames + 24, phases, scene);
  } else if (id === "react-settle") {
    addAction(scene, "react", {
      type: "react",
      ...actionBase(start, tuning),
      preset: "shocked",
      intensity: tuning.intensity,
    });
    phases.push(
      { frame: start, label: "react", tone: "action" },
      { frame: Math.max(start, end - tuning.blendOutFrames), label: "settle", tone: "transition" },
    );
    return finalize(id, end + Math.max(30, tuning.blendOutFrames + 12), phases, scene);
  }

  phases.push(
    { frame: start, label: id.replaceAll("-", " "), tone: "action" },
    { frame: end, label: "settle", tone: "transition" },
  );
  return finalize(id, end + 30, phases, scene);
}

export function clampLabFrame(frame: number, totalFrames: number) {
  return Math.max(0, Math.min(Math.max(0, totalFrames - 1), Math.round(frame)));
}

export function formatLabTime(frame: number) {
  const wholeSeconds = Math.floor(frame / LAB_FPS),
    frames = Math.max(0, frame) % LAB_FPS;
  return `${String(Math.floor(wholeSeconds / 60)).padStart(2, "0")}:${String(wholeSeconds % 60).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}
