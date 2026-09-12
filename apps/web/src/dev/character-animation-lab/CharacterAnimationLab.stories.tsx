import type { CharacterAnimationLabProps } from "./CharacterAnimationLab";
import { CharacterAnimationLab } from "./CharacterAnimationLab";
import type { ScenarioId } from "./scenarios";
import { scenarioCatalog } from "./scenarios";

const meta = {
  title: "Video / Character Animation Lab",
  component: CharacterAnimationLab,
  parameters: { layout: "fullscreen" },
  argTypes: {
    scenarioId: { control: "select", options: scenarioCatalog.map((item) => item.id) },
    durationFrames: { control: { type: "range", min: 8, max: 180, step: 1 } },
    blendInFrames: { control: { type: "range", min: 0, max: 45, step: 1 } },
    blendOutFrames: { control: { type: "range", min: 0, max: 45, step: 1 } },
    intensity: { control: { type: "range", min: 0, max: 1, step: 0.05 } },
    autoPlay: { control: "boolean" },
    onionSkin: { control: "boolean" },
    initialFrame: { control: { type: "range", min: 0, max: 239, step: 1 } },
  },
  args: {
    durationFrames: 60,
    blendInFrames: 8,
    blendOutFrames: 10,
    intensity: 0.9,
    autoPlay: true,
    onionSkin: false,
    initialFrame: 0,
  },
};

export default meta;

type Story = { args: CharacterAnimationLabProps };
const story = (scenarioId: ScenarioId): Story => ({ args: { scenarioId } });

export const GoldenAdvertising = {
  args: { scenarioId: "golden-ad" as const, autoPlay: false, initialFrame: 132 },
};
export const GoldenAdvertisingRaw = {
  args: { scenarioId: "golden-ad-raw" as const, autoPlay: false, initialFrame: 132 },
};
export const GoldenAdvertisingCameraOff = {
  args: { scenarioId: "golden-ad-camera-off" as const, autoPlay: false, initialFrame: 132 },
};
export const GoldenAdvertisingSecondPack = {
  args: { scenarioId: "golden-ad-customer" as const, autoPlay: false, initialFrame: 132 },
};

export const Idle = story("idle");
export const Enter = story("enter");
export const Blink = story("blink");
export const Look = story("look");
export const TalkVisemes = story("talk");

export const GesturePoint = story("gesture-point");
export const GestureExplain = story("gesture-explain");
export const GestureShrug = story("gesture-shrug");
export const GestureThink = story("gesture-think");

export const ReactHappy = story("react-happy");
export const ReactShocked = story("react-shocked");
export const ReactThinking = story("react-thinking");

export const PointAtTarget = story("point");
export const ShowProp = story("show-prop");

export const IdleLookTalk = story("idle-look-talk");
export const EnterExplain = story("enter-explain");
export const ShowPropPoint = story("show-prop-point");
export const ReactSettle = story("react-settle");
export const AllGestures = story("gesture-matrix");
export const AllEmotions = story("emotion-matrix");
export const AllCameraMoves = story("camera-matrix");
export const AllEffects = story("effect-matrix");
export const LandscapeStage = story("stage-landscape");
export const SquareStage = story("stage-square");
export const EnergeticCustomer = story("new-customer");
export const CompoundProcedural = story("compound-procedural");
