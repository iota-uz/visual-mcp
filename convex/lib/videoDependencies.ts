import {
  canonical,
  type ScriptDocument,
  type StaleDependency,
  type TimelineDocument,
} from "../../packages/video/src/contracts";

const different = (a: unknown, b: unknown) => canonical(a ?? null) !== canonical(b ?? null);
/** Compares canonical documents, not patch paths or guessed downstream work. */
export function patchDependencies(args: {
  draftId: string;
  timelineRevision: string;
  kind: "script" | "timeline";
  beforeScript: ScriptDocument;
  script: ScriptDocument;
  beforeTimeline: TimelineDocument;
  timeline: TimelineDocument;
}) {
  const { beforeScript, script, beforeTimeline, timeline } = args;
  const affected = new Set<string>(),
    narration = new Set<string>(),
    visual = new Set<string>(),
    context = new Set<string>();
  const dependencies: StaleDependency[] = [];
  let truncated = false;
  const add = (dependency: StaleDependency) => {
    if (dependencies.length < 128) dependencies.push(dependency);
    else truncated = true;
  };
  if (args.kind === "script") {
    const global =
      different(beforeScript.title, script.title) ||
      different(beforeScript.premise, script.premise) ||
      different(beforeScript.writingSystem, script.writingSystem);
    for (const id of new Set([...beforeScript.sceneOrder, ...script.sceneOrder])) {
      const before = beforeScript.scenesById[id],
        after = script.scenesById[id];
      if (
        !global &&
        !different(before, after) &&
        beforeScript.sceneOrder.indexOf(id) === script.sceneOrder.indexOf(id)
      )
        continue;
      affected.add(id);
      context.add(id);
      if (different(before?.narration, after?.narration) || !before || !after) narration.add(id);
      if (
        different(before?.visual, after?.visual) ||
        different(before?.shotsById, after?.shotsById) ||
        !before ||
        !after
      )
        visual.add(id);
      for (const [shotId, shot] of Object.entries(before?.shotsById ?? {}))
        if (shot.selectedVideo)
          add({
            kind: "shot_candidate",
            draftId: args.draftId,
            sceneId: id,
            shotId,
            asset: shot.selectedVideo,
            ...(shot.selectedVideoJobId ? { jobId: shot.selectedVideoJobId } : {}),
            reason: different(shot, after?.shotsById[shotId])
              ? "shot_plan_changed"
              : "scene_context_changed",
          });
    }
    const ranges = Object.values(beforeTimeline.tracksById)
      .flatMap((t) => Object.values(t.clipsById))
      .filter((c) => c.sceneId && affected.has(c.sceneId));
    for (const [trackId, track] of Object.entries(beforeTimeline.tracksById))
      for (const [clipId, clip] of Object.entries(track.clipsById)) {
        const linked = clip.sceneId
          ? [clip.sceneId]
          : ranges
              .filter(
                (r) =>
                  r.startFrame < clip.startFrame + clip.durationFrames &&
                  clip.startFrame < r.startFrame + r.durationFrames,
              )
              .map((r) => r.sceneId!);
        let reason: StaleDependency["reason"] | null = null;
        if (["voice", "caption"].includes(track.kind) && linked.some((id) => narration.has(id)))
          reason = "narration_changed";
        else if (track.kind === "visual" && linked.some((id) => visual.has(id)))
          reason = "scene_visual_changed";
        else if (linked.some((id) => context.has(id))) reason = "scene_context_changed";
        if (reason)
          add({
            kind: "timeline_clip",
            draftId: args.draftId,
            timelineRevision: args.timelineRevision,
            trackId,
            clipId,
            ...(clip.source.kind === "asset" ? { asset: clip.source.asset } : {}),
            reason,
          });
      }
  } else {
    const global =
      different(beforeTimeline.fps, timeline.fps) ||
      beforeTimeline.durationFrames !== timeline.durationFrames;
    for (const trackId of new Set([...beforeTimeline.trackOrder, ...timeline.trackOrder])) {
      const before = beforeTimeline.tracksById[trackId],
        after = timeline.tracksById[trackId];
      const reordered =
        beforeTimeline.trackOrder.indexOf(trackId) !== timeline.trackOrder.indexOf(trackId);
      for (const clipId of new Set([...(before?.clipOrder ?? []), ...(after?.clipOrder ?? [])])) {
        const a = before?.clipsById[clipId],
          b = after?.clipsById[clipId];
        if (
          !global &&
          !reordered &&
          before?.kind === after?.kind &&
          !different(a, b) &&
          before?.clipOrder.indexOf(clipId) === after?.clipOrder.indexOf(clipId)
        )
          continue;
        if (a?.sceneId) affected.add(a.sceneId);
        if (b?.sceneId) affected.add(b.sceneId);
      }
    }
    if (global) for (const id of script.sceneOrder) affected.add(id);
  }
  // A collection ref explicitly signals further dependencies; never silently
  // pretend a bounded response enumerated all rows.
  if (truncated)
    dependencies.push({
      kind: "draft_dependents",
      draftId: args.draftId,
      reason: "additional_dependencies_require_review",
    });
  return { affectedSceneIds: [...affected], staleDependents: dependencies };
}
