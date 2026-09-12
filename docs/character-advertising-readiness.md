# Character engine: advertising readiness

This work improves the reusable engine. Farq is a regression fixture, not a
special renderer or the product being delivered. Implementation does not by
itself certify artistic quality: the same renderer must be inspected in the lab.

## Work packages

- [x] Motion: deterministic channel mixing and continuous pose handoffs.
- [x] Acting: reusable preparation, attention, accent, hold and settle beats.
- [x] Face: eye/head timing, controllable stillness and time-based speech shaping.
- [x] Contact: stable grip, explicit placement/release and explicit layering.
- [x] Staging: reusable layouts, authored environment planes and camera moves.
- [x] Graphic hierarchy: screen-space prices, savings and callouts.
- [x] Sound cues: semantic events compile into validated existing SFX timeline clips.
- [x] Integration: strict contracts, shared preview/render path, all callers updated.
- [x] Benchmark: one golden sequence, isolated diagnostic variants and another pack.
- [x] Verification: contract/runtime tests, builds, frame inspection and limitations.

## Acceptance criteria

1. Seeking directly to any frame produces the same state as sequential playback.
2. Adjacent gestures can hand off without an unintended return to rest.
3. Attention precedes the gesture accent; holds can suppress distracting idle motion.
4. Timing expressed in seconds remains consistent across supported frame rates.
5. Prop ownership and placement remain deterministic before and after contact.
6. Camera transforms affect world content without moving screen-space price text.
7. Layout and acting helpers work with more than the official Farq character pack.
8. The local lab executes production rendering code and exposes diagnostic cases.

## Scope boundaries

No new user-facing editor controls, character-specific renderer, walking/leg rig,
automatic artistic quality score, or new sound-generation service. Existing audio
mixing remains the foundation for authored sound cues. Full production-video sound
and editorial quality require reviewing a concrete audiovisual candidate.

## Review protocol

Inspect key poses, contact frames, gesture handoffs and camera boundaries, then
watch at normal speed. Compare diagnostic variants with one factor changed at a
time. Record the three most consequential visible defects with frame numbers;
do not replace evidence with an aggregate score.

## Local review

Run `npm run storybook` and open **Video / Character Animation Lab → Golden
Advertising**. The master scene has raw-acting, camera-off and second-pack
variants. `initialFrame` plus paused playback provides repeatable frame
inspection; ordinary action stories remain available for isolated tuning.

Run `npm run render:character-benchmark` to export the same golden scenario
through the production Remotion composition. The MP4 and diagnostic PNGs are
written to the ignored `output/character-benchmark/` directory. No live backend
or authentication is involved.

## Engine authoring entry points

- `compileCharacterActing()` from `@visual-canvas/video/character-acting`:
  semantic beats become schema-validated, frame-addressable actions.
- `stageCharacterActors()` from `@visual-canvas/video/character-staging`:
  single-product, two-shot and reaction-closeup starting compositions derive
  scale and position from pack dimensions.
- `compileCharacterCues()` from `@visual-canvas/video/character-cues`:
  explicit semantic event frames and pinned audio assets become ordinary SFX
  timeline clips; provenance remains separate from strict clip data.
- `character-scene@3`: explicit scene timebase must match the timeline;
  environment planes and camera treatment are declared in scene props.

## Deliberate limits

- The stage remains vertical, 1080 × 1920 in authored coordinates.
- A scene currently has one camera treatment. A zero hold duration preserves
  the final framing; a positive hold returns smoothly to the initial framing.
- There is no walking/leg solver, physics or general environment collision solver.
- Impossible pickups fail explicitly; the engine does not automatically restage
  an actor to reach an impossible object.
- Visemes and meaningful speech accents are authored inputs; this change does
  not infer phonemes or acting direction from an audio waveform.
- Vector packs retain the existing solid-fill artwork model. This is not full
  SVG gradient/filter reproduction.
- The exported diagnostic scene is silent. Sound-cue compilation is tested
  against the existing timeline contract; a finished ad still needs real audio
  assets and an audiovisual review.

## Integration review findings

- A zero-weight successor must not suppress the previous action's fade-out.
- Stillness suppresses idle/secondary motion, not the primary intentional gesture.
- Explicit settle duration must be consumed, not stretched over the remaining clip.
- Layout bounds are centered at the pack root, not anchored at the feet.
- Camera framing must contain the actor as well as the held product.
- World-space parallax must reduce background travel, not increase it.
- Price cards need non-overlapping staging and an available sans-serif fallback.
- Cue compiler output must parse as real Timeline clips; metadata lives separately.
- Contact must preserve the world transform and reject impossible pickup targets.

These findings are acceptance checks, not claims that automated tests establish
the artistic quality of a finished advertisement.

## Verification receipt (2026-09-12)

- Video package: 25 tests passed; worker: 101 tests passed.
- Focused web preview/lab tests: 22 passed; Convex video/review tests: 16 passed.
- Video, worker, production web and static Storybook builds passed.
- All 22 lab scenarios evaluated at every frame without runtime errors.
- Production Remotion export succeeded: 240-frame MP4 and eight diagnostic PNGs.
- Rendered frames were inspected, including the upper pointing pose at frame
  144 and release boundary at frames 190/191. This is sampled visual evidence,
  not a continuous-motion or audiovisual quality certification.
- Remaining fixture-level art direction includes the large vertical gap between
  actor and pricing, and the tilted placed phone. Stable contact is not automatic
  surface alignment or collision resolution.

The schema revision is intentionally breaking. Saved `character-scene@2` scenes
must be explicitly reauthored as revision 3 before rollout; no persisted-data
migration or live deployment is included in this implementation.
