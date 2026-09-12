import type { CharacterSceneProps } from "@visual-canvas/video/registry";
import type { ReactNode } from "react";

type Emotion = CharacterSceneProps["actorsById"][string]["initialEmotion"];
type Gesture = "rest" | "point" | "explain" | "shrug" | "show-phone";
type Viseme = "rest" | "a" | "e" | "o" | "u" | "m";

export type CharacterActorState = {
  x: number;
  y: number;
  opacity: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  eyeOpen: number;
  gazeX: number;
  gazeY: number;
  emotion: Emotion;
  gesture: Gesture;
  viseme: Viseme;
  mouthScaleY: number;
  speaking: boolean;
};

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const smooth = (value: number) => {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
};
const hash = (value: string, seed: number) => {
  let result = seed >>> 0;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
};
const progress = (frame: number, start: number, duration: number) =>
  clamp((frame - start) / Math.max(1, duration));

export function evaluateCharacterActors(
  props: CharacterSceneProps,
  frame: number,
): Record<string, CharacterActorState> {
  const states: Record<string, CharacterActorState> = {};
  for (const actorId of props.actorOrder) {
    const actor = props.actorsById[actorId];
    if (!actor) continue;
    const phase = (hash(actorId, props.seed) % 1000) / 1000;
    const idle = Math.sin(frame * 0.075 + phase * Math.PI * 2);
    const blinkPhase = (frame + Math.floor(phase * 91)) % 118;
    const autoEyeOpen = blinkPhase < 5 ? Math.max(0.08, Math.abs(blinkPhase - 2.5) / 2.5) : 1;
    states[actorId] = {
      x: actor.x,
      y: actor.y + idle * 0.0025,
      opacity: 1,
      scaleX: actor.scale * (1 + Math.abs(idle) * 0.012),
      scaleY: actor.scale * (1 - Math.abs(idle) * 0.012),
      rotation: idle * 1.2,
      eyeOpen: autoEyeOpen,
      gazeX: actor.facing === "left" ? -0.35 : 0.35,
      gazeY: 0,
      emotion: actor.initialEmotion,
      gesture: "rest",
      viseme: "rest",
      mouthScaleY: 1,
      speaking: false,
    };

    const enter = props.actionOrder
      .map((actionId) => props.actionsById[actionId])
      .find((action) => action?.type === "enter" && action.actorId === actorId);
    if (enter?.type === "enter" && frame < enter.startFrame) {
      states[actorId].x += enter.from === "left" ? -0.72 : 0.72;
      states[actorId].opacity = 0;
    }
  }

  const actorsWithExplicitLook = new Set(
    props.actionOrder
      .map((actionId) => props.actionsById[actionId])
      .filter(
        (action) =>
          action?.type === "look" &&
          frame >= action.startFrame &&
          frame < action.startFrame + action.durationFrames,
      )
      .map((action) => action?.actorId),
  );

  for (const actionId of props.actionOrder) {
    const action = props.actionsById[actionId];
    const state = action ? states[action.actorId] : undefined;
    if (
      !action ||
      !state ||
      frame < action.startFrame ||
      frame >= action.startFrame + action.durationFrames
    )
      continue;
    const p = progress(frame, action.startFrame, action.durationFrames);
    if (action.type === "enter") {
      const eased = 1 - (1 - p) ** 3;
      state.x += (action.from === "left" ? -0.72 : 0.72) * (1 - eased);
      state.opacity = smooth(p * 4);
      state.y -= Math.abs(Math.sin(p * Math.PI * 3)) * 0.018 * (1 - p);
      state.rotation += (action.from === "left" ? -1 : 1) * Math.sin(p * Math.PI) * 8;
      state.scaleX *= 1 + Math.sin(p * Math.PI * 4) * 0.035;
      state.scaleY *= 1 - Math.sin(p * Math.PI * 4) * 0.035;
    } else if (action.type === "look") {
      if (action.target === "camera") {
        state.gazeX = 0;
        state.gazeY = 0;
      } else if (action.target === "left" || action.target === "right") {
        state.gazeX = action.target === "left" ? -1 : 1;
        state.gazeY = 0;
      } else {
        const target = props.actorsById[action.target];
        const origin = props.actorsById[action.actorId];
        if (target && origin) {
          const dx = target.x - origin.x;
          const dy = target.y - origin.y;
          const length = Math.max(0.0001, Math.hypot(dx, dy));
          state.gazeX = clamp(dx / length, -1, 1);
          state.gazeY = clamp(dy / length, -1, 1);
        }
      }
    } else if (action.type === "blink") {
      state.eyeOpen = Math.max(0.05, Math.abs(p - 0.5) * 2);
    } else if (action.type === "talk") {
      if (action.emotion) state.emotion = action.emotion;
      const localFrame = frame - action.startFrame;
      let currentIndex = -1;
      for (let index = 0; index < action.visemes.length; index++) {
        if ((action.visemes[index]?.frame ?? Number.POSITIVE_INFINITY) > localFrame) break;
        currentIndex = index;
      }
      const current = action.visemes[currentIndex];
      const next = action.visemes[currentIndex + 1];
      state.speaking = true;
      state.viseme = current?.shape ?? "rest";
      if (current) {
        const beatEnd = next?.frame ?? action.durationFrames;
        const attack = smooth((localFrame - current.frame) / 2);
        const release = smooth((beatEnd - localFrame) / 2);
        const envelope = Math.min(attack, release);
        state.mouthScaleY =
          current.shape === "m" || current.shape === "rest" ? 0.55 : 0.82 + envelope * 0.28;
      } else state.mouthScaleY = 0.55;
    } else if (action.type === "gesture") {
      state.gesture = action.preset;
      if (action.preset === "point" && !actorsWithExplicitLook.has(action.actorId)) {
        state.gazeX = 0;
        state.gazeY = 0.75;
      }
    } else if (action.type === "react") {
      state.emotion = action.preset;
      const impulse = Math.sin(smooth(p) * Math.PI);
      if (action.preset === "shocked") {
        const facingDirection = props.actorsById[action.actorId]?.facing === "right" ? 1 : -1;
        state.x -= facingDirection * impulse * 0.055;
        state.y += impulse * 0.018;
        state.rotation -= facingDirection * impulse * 11;
        state.scaleX *= 1 + impulse * 0.17;
        state.scaleY *= 1 - impulse * 0.14;
      } else if (action.preset === "happy") state.y -= Math.abs(Math.sin(p * Math.PI * 3)) * 0.022;
      else {
        const facingDirection = props.actorsById[action.actorId]?.facing === "right" ? 1 : -1;
        state.rotation -= facingDirection * impulse * 5;
        state.gazeX = facingDirection * 0.62;
        state.gazeY = -0.72;
      }
    }
  }
  return states;
}

function mouthPath(viseme: Viseme, emotion: Emotion, speaking: boolean) {
  if (viseme === "a") return "M-24 34 Q0 72 24 34 Q0 12 -24 34";
  if (viseme === "e") return "M-30 36 Q0 54 30 36";
  if (viseme === "o") return "M-17 38 A17 21 0 1 0 17 38 A17 21 0 1 0 -17 38";
  if (viseme === "u") return "M-12 39 A12 15 0 1 0 12 39 A12 15 0 1 0 -12 39";
  if (viseme === "m") return "M-23 40 Q0 35 23 40";
  if (speaking) return "M-24 39 Q0 43 24 39";
  if (emotion === "shocked") return "M-18 39 A18 23 0 1 0 18 39 A18 23 0 1 0 -18 39";
  if (emotion === "happy") return "M-28 31 Q0 61 28 31";
  if (emotion === "thinking") return "M-23 40 Q2 31 25 42";
  return "M-24 39 Q0 45 24 39";
}

function armPaths(gesture: Gesture, emotion: Emotion) {
  if (gesture === "point") return ["M-62 35 Q-118 48 -138 103", "M62 35 Q118 88 142 168"];
  if (gesture === "explain") return ["M-62 35 Q-130 -12 -158 -68", "M62 35 Q132 -4 162 -54"];
  if (gesture === "shrug") return ["M-62 35 Q-128 4 -164 22", "M62 35 Q128 4 164 22"];
  if (gesture === "show-phone") return ["M-62 35 Q-118 80 -138 110", "M62 35 Q103 60 116 91"];
  if (emotion === "thinking") return ["M-62 35 Q-112 72 -126 116", "M62 35 Q67 76 30 73"];
  return ["M-62 35 Q-112 72 -126 116", "M62 35 Q112 72 126 116"];
}

function Phone() {
  return (
    <g aria-label="phone">
      <circle cx="116" cy="91" r="13" fill="#ff7a1a" />
      <rect
        x="112"
        y="48"
        width="66"
        height="108"
        rx="12"
        fill="#211108"
        stroke="#fff8ee"
        strokeWidth="6"
      />
      <rect x="120" y="61" width="50" height="78" rx="6" fill="#fff8ee" />
      <rect x="129" y="72" width="32" height="8" rx="4" fill="#ff7a1a" />
      <circle cx="145" cy="99" r="13" fill="#ff7a1a" opacity="0.9" />
      <path
        d="M138 99 L143 104 L153 93"
        fill="none"
        stroke="#211108"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="131" y="122" width="28" height="6" rx="3" fill="#7d675d" />
      <circle cx="145" cy="147" r="4" fill="#fff8ee" />
    </g>
  );
}

function FarqRig({ state }: { state: CharacterActorState }) {
  const [leftArm, rightArm] = armPaths(state.gesture, state.emotion);
  const pupilX = state.gazeX * 9;
  const pupilY = state.gazeY * 7;
  return (
    <>
      <ellipse cx="0" cy="130" rx="115" ry="22" fill="#000000" opacity="0.26" />
      <path d={leftArm} fill="none" stroke="#ff7a1a" strokeWidth="22" strokeLinecap="round" />
      <path d={rightArm} fill="none" stroke="#ff7a1a" strokeWidth="22" strokeLinecap="round" />
      <circle cx="-56" cy="-29" r="49" fill="#ff7a1a" />
      <circle cx="56" cy="29" r="49" fill="#ff7a1a" />
      <path d="M-84 84 L84 -84" stroke="#ff7a1a" strokeWidth="34" strokeLinecap="round" />
      <circle r="87" fill="#fff8ee" stroke="#211108" strokeWidth="9" />
      {[-29, 29].map((cx) => (
        <g key={cx} transform={`translate(${cx} -12) scale(1 ${state.eyeOpen})`}>
          <circle r="23" fill="#ffffff" />
          <circle cx={pupilX} cy={pupilY} r="10" fill="#211108" />
        </g>
      ))}
      <g transform={`translate(0 40) scale(1 ${state.mouthScaleY}) translate(0 -40)`}>
        <path
          d={mouthPath(state.viseme, state.emotion, state.speaking)}
          fill="none"
          stroke="#211108"
          strokeWidth="9"
          strokeLinecap="round"
        />
      </g>
      {state.gesture === "show-phone" ? <Phone /> : null}
    </>
  );
}

function CustomerRig({ state }: { state: CharacterActorState }) {
  const [leftArm, rightArm] = armPaths(state.gesture, state.emotion);
  const pupilX = state.gazeX * 10;
  const pupilY = state.gazeY * 7;
  const browTilt = state.emotion === "thinking" ? -12 : state.emotion === "shocked" ? 10 : 0;
  return (
    <>
      <ellipse cx="0" cy="130" rx="108" ry="22" fill="#000000" opacity="0.25" />
      <path d={leftArm} fill="none" stroke="#f2d7b6" strokeWidth="22" strokeLinecap="round" />
      <path d={rightArm} fill="none" stroke="#f2d7b6" strokeWidth="22" strokeLinecap="round" />
      <circle r="100" fill="#f2d7b6" stroke="#211108" strokeWidth="9" />
      {[-34, 34].map((cx) => (
        <g key={cx} transform={`translate(${cx} -10) scale(1 ${state.eyeOpen})`}>
          <circle r="27" fill="#ffffff" />
          <circle cx={pupilX} cy={pupilY} r="11" fill="#211108" />
        </g>
      ))}
      <path
        d={`M-58 -52 L-15 ${-55 + browTilt}`}
        stroke="#211108"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <path
        d={`M15 ${-55 - browTilt} L58 -52`}
        stroke="#211108"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <g transform={`translate(0 40) scale(1 ${state.mouthScaleY}) translate(0 -40)`}>
        <path
          d={mouthPath(state.viseme, state.emotion, state.speaking)}
          fill="none"
          stroke="#211108"
          strokeWidth="9"
          strokeLinecap="round"
        />
      </g>
      {state.gesture === "show-phone" ? <Phone /> : null}
    </>
  );
}

function Overlay({
  overlay,
  frame,
}: {
  overlay: CharacterSceneProps["overlaysById"][string];
  frame: number;
}) {
  if (frame < overlay.startFrame || frame >= overlay.endFrame) return null;
  const enter = smooth((frame - overlay.startFrame) / 10);
  const exit = smooth((overlay.endFrame - frame) / 8);
  const opacity = Math.min(enter, exit);
  const styles: Record<
    typeof overlay.style,
    { fill: string; color: string; width: number; height: number; size: number }
  > = {
    caption: { fill: "#211108", color: "#fff8ee", width: 820, height: 112, size: 48 },
    "price-old": { fill: "#fff8ee", color: "#8a3d1b", width: 410, height: 140, size: 52 },
    "price-new": { fill: "#ff7a1a", color: "#211108", width: 410, height: 140, size: 52 },
    cta: { fill: "#ff7a1a", color: "#211108", width: 760, height: 126, size: 44 },
  };
  const style = styles[overlay.style];
  return (
    <g
      transform={`translate(${overlay.x * 1080} ${overlay.y * 1920}) scale(${0.92 + enter * 0.08})`}
      opacity={opacity}
    >
      <rect
        x={-style.width / 2}
        y={-style.height / 2}
        width={style.width}
        height={style.height}
        rx="28"
        fill={style.fill}
      />
      <text
        y={style.size * 0.34}
        textAnchor="middle"
        fill={style.color}
        fontFamily="DejaVu Sans"
        fontWeight="700"
        fontSize={style.size}
      >
        {overlay.text}
      </text>
    </g>
  );
}

export function CharacterScene({ props, frame }: { props: CharacterSceneProps; frame: number }) {
  const states = evaluateCharacterActors(props, frame);
  const actors: ReactNode[] = props.actorOrder.map((actorId) => {
    const actor = props.actorsById[actorId];
    const state = states[actorId];
    if (!actor || !state) return null;
    const facing = actor.facing === "left" ? -1 : 1;
    return (
      <g
        key={actorId}
        opacity={state.opacity}
        transform={`translate(${state.x * 1080} ${state.y * 1920}) rotate(${state.rotation}) scale(${state.scaleX * facing} ${state.scaleY})`}
      >
        {actor.character === "farq-mascot" ? (
          <FarqRig state={state} />
        ) : (
          <CustomerRig state={state} />
        )}
      </g>
    );
  });
  return (
    <svg
      viewBox="0 0 1080 1920"
      width="100%"
      height="100%"
      role="img"
      aria-label={props.caption ?? "Farq character animation"}
    >
      <rect width="1080" height="1920" fill={props.background} />
      <circle cx="890" cy="235" r="205" fill="#ff7a1a" opacity="0.12" />
      <path d="M0 1320 C280 1210 410 1390 670 1280 S920 1240 1080 1350 V1920 H0Z" fill="#2b1710" />
      {actors}
      {props.overlayOrder.map((id) => {
        const overlay = props.overlaysById[id];
        return overlay ? <Overlay key={id} overlay={overlay} frame={frame} /> : null;
      })}
    </svg>
  );
}
