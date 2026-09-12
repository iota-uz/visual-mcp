import { describe, expect, it } from "vitest";
import { CharacterSceneProps } from "../../../../../packages/video/src/registry";
import { buildCharacterScenario, clampLabFrame, formatLabTime, scenarioCatalog } from "./scenarios";

describe("character animation lab scenarios", () => {
  it("constructs every catalog scenario with the production scene contract", () => {
    expect(scenarioCatalog).toHaveLength(22);
    for (const item of scenarioCatalog) {
      const scenario = buildCharacterScenario(item.id);
      expect(CharacterSceneProps.safeParse(scenario.props).success, item.id).toBe(true);
      expect(scenario.totalFrames).toBeGreaterThan(0);
      expect(scenario.phases[0]).toEqual(expect.objectContaining({ frame: 0 }));
    }
  });

  it("keeps golden diagnostics isolated to acting, camera and character pack", () => {
    const compiled = buildCharacterScenario("golden-ad").props;
    const raw = buildCharacterScenario("golden-ad-raw").props;
    const cameraOff = buildCharacterScenario("golden-ad-camera-off").props;
    const secondPack = buildCharacterScenario("golden-ad-customer").props;
    expect(raw.camera).toEqual(compiled.camera);
    expect(raw.staging).toEqual(compiled.staging);
    expect(raw.overlaysById).toEqual(compiled.overlaysById);
    expect(Object.values(raw.actionsById).every((action) => action.acting === undefined)).toBe(
      true,
    );
    expect(Object.values(compiled.actionsById).every((action) => action.acting !== undefined)).toBe(
      true,
    );
    expect(cameraOff.actionsById).toEqual(compiled.actionsById);
    expect(cameraOff.camera).toEqual({ ...compiled.camera, movement: "locked" });
    expect(secondPack.actionsById).toEqual(compiled.actionsById);
    expect(secondPack.characterPacksById.customer?.id).toBe("customer");
  });

  it("rebuilds action timing and intensity from tuning controls", () => {
    const scenario = buildCharacterScenario("gesture-explain", {
      durationFrames: 75,
      blendInFrames: 13,
      blendOutFrames: 17,
      intensity: 0.55,
    });
    const action = scenario.props.actionsById.gesture;
    expect(action).toMatchObject({
      type: "gesture",
      durationFrames: 75,
      blendInFrames: 13,
      blendOutFrames: 17,
      intensity: 0.55,
    });
  });

  it("keeps transition actions ordered, separated and contract-valid", () => {
    for (const id of ["idle-look-talk", "enter-explain", "show-prop-point"] as const) {
      const { props } = buildCharacterScenario(id, {
        durationFrames: 24,
        blendInFrames: 6,
        blendOutFrames: 8,
        intensity: 1,
      });
      const starts = props.actionOrder.map((actionId) => {
        const action = props.actionsById[actionId];
        if (!action) throw new Error(`Missing action ${actionId}`);
        return action.startFrame;
      });
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
      expect(CharacterSceneProps.safeParse(props).success).toBe(true);
    }
  });

  it("lets showProp reveal and attach a prop that starts hidden", () => {
    const { props } = buildCharacterScenario("show-prop");
    const action = props.actionsById.showProp;
    expect(action).toMatchObject({ type: "showProp", propId: "phone", hand: "right" });
    expect(props.propsById.phone?.initiallyVisible).toBe(false);
    expect(props.propsById.phone?.attachment).toBeUndefined();
  });

  it("clamps stepping and scrubbing to inclusive frame boundaries", () => {
    expect(clampLabFrame(-20, 90)).toBe(0);
    expect(clampLabFrame(22.6, 90)).toBe(23);
    expect(clampLabFrame(900, 90)).toBe(89);
    expect(clampLabFrame(1, 0)).toBe(0);
  });

  it("formats 30 fps timecode", () => {
    expect(formatLabTime(0)).toBe("00:00:00");
    expect(formatLabTime(29)).toBe("00:00:29");
    expect(formatLabTime(30)).toBe("00:01:00");
    expect(formatLabTime(1_845)).toBe("01:01:15");
  });
});
