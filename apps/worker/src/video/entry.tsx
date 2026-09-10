import { Composition, registerRoot } from "remotion";
import { type RenderProps, VideoComposition } from "./composition.js";

const defaults: RenderProps = {
  format: { width: 360, height: 640, fps: { numerator: 30, denominator: 1 } },
  timeline: {
    fps: { numerator: 30, denominator: 1 },
    durationFrames: 30,
    trackOrder: [],
    tracksById: {},
  },
  files: {},
};
function Root() {
  return (
    <Composition
      id="VideoStudio"
      component={VideoComposition}
      width={360}
      height={640}
      fps={30}
      durationInFrames={30}
      defaultProps={defaults}
      calculateMetadata={({ props }) => ({
        width: props.format.width,
        height: props.format.height,
        fps: props.format.fps.numerator / props.format.fps.denominator,
        durationInFrames: props.timeline.durationFrames,
      })}
    />
  );
}
registerRoot(Root);
