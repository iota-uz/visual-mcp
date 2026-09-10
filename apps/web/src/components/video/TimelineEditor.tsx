import type { TimelineDocument } from "../../../../../packages/video/src/contracts";
import { Button } from "../ui/Button";
import { TextInput } from "../ui/TextInput";

export function TimelineEditor({
  document,
  onChange,
  disabled,
}: {
  document: TimelineDocument;
  onChange: (next: TimelineDocument) => void;
  disabled: boolean;
}) {
  const fps = document.fps.numerator / document.fps.denominator;
  function addText() {
    const trackId = `caption_${crypto.randomUUID().replaceAll("-", "")}`;
    onChange({
      ...document,
      trackOrder: [...document.trackOrder, trackId],
      tracksById: {
        ...document.tracksById,
        [trackId]: {
          kind: "caption",
          clipOrder: ["caption"],
          clipsById: {
            caption: {
              startFrame: 0,
              durationFrames: document.durationFrames,
              source: { kind: "text", text: "" },
            },
          },
        },
      },
    });
  }
  function patch(
    trackId: string,
    clipId: string,
    patch: Partial<TimelineDocument["tracksById"][string]["clipsById"][string]>,
  ) {
    const track = document.tracksById[trackId];
    const clip = track?.clipsById[clipId];
    if (!track || !clip) return;
    onChange({
      ...document,
      tracksById: {
        ...document.tracksById,
        [trackId]: {
          ...track,
          clipsById: { ...track.clipsById, [clipId]: { ...clip, ...patch } },
        },
      },
    });
  }
  return (
    <section className="video-timeline" aria-label="Timeline">
      <div className="video-section-heading">
        <h2>Timeline</h2>
        <Button size="sm" onClick={addText} disabled={disabled || document.trackOrder.length >= 32}>
          Add caption track
        </Button>
      </div>
      <TextInput
        id="timeline-duration"
        type="number"
        label="Duration in frames"
        labelVisible
        min={1}
        max={72000}
        step={1}
        value={document.durationFrames}
        readOnly={disabled}
        onChange={(event) => {
          const value = Number(event.target.value);
          if (Number.isInteger(value) && value > 0)
            onChange({ ...document, durationFrames: value });
        }}
      />
      <p className="video-hint">
        {(document.durationFrames / fps).toFixed(2)} seconds at {fps.toFixed(2)} fps. Timing changes
        do not start a render.
      </p>
      {document.trackOrder.length === 0 && (
        <p className="video-hint">
          No clips placed yet. Your agent can arrange pinned media here; add a caption track to
          start editing timing.
        </p>
      )}
      {document.trackOrder.map((trackId) => {
        const track = document.tracksById[trackId];
        if (!track) return null;
        return (
          <div className="video-track" key={trackId}>
            <h3>{track.kind}</h3>
            {track.clipOrder.map((clipId) => {
              const clip = track.clipsById[clipId];
              if (!clip) return null;
              const invalid = clip.startFrame + clip.durationFrames > document.durationFrames;
              return (
                <div className="video-clip" key={clipId}>
                  <div className="video-clip-bar" aria-hidden="true">
                    <span
                      style={{
                        marginLeft: `${Math.min(100, (clip.startFrame / document.durationFrames) * 100)}%`,
                        width: `${Math.min(100, (clip.durationFrames / document.durationFrames) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="video-field-pair">
                    <TextInput
                      id={`${trackId}-${clipId}-start`}
                      label="Start frame"
                      labelVisible
                      type="number"
                      min={0}
                      step={1}
                      value={clip.startFrame}
                      readOnly={disabled}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isInteger(value) && value >= 0)
                          patch(trackId, clipId, { startFrame: value });
                      }}
                    />
                    <TextInput
                      id={`${trackId}-${clipId}-length`}
                      label="Length in frames"
                      labelVisible
                      type="number"
                      min={1}
                      step={1}
                      value={clip.durationFrames}
                      readOnly={disabled}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isInteger(value) && value > 0)
                          patch(trackId, clipId, { durationFrames: value });
                      }}
                    />
                  </div>
                  {clip.source.kind === "text" ? (
                    <TextInput
                      id={`${trackId}-${clipId}-text`}
                      label="Caption text"
                      labelVisible
                      value={clip.source.text}
                      readOnly={disabled}
                      onChange={(event) =>
                        patch(trackId, clipId, {
                          source: { kind: "text", text: event.target.value },
                        })
                      }
                    />
                  ) : clip.source.kind === "component" ? (
                    <p className="video-hint">
                      Component: {clip.source.component.resourceId} @{" "}
                      {clip.source.component.revisionId}. Immutable validated props preserved.
                    </p>
                  ) : (
                    <p className="video-hint">
                      Pinned asset: {clip.source.asset.assetId}, revision{" "}
                      {clip.source.asset.revisionId}
                    </p>
                  )}
                  {invalid && (
                    <p role="alert">
                      This clip extends beyond the timeline. Increase duration or shorten the clip.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
