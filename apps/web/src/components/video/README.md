# Video studio architecture

The video studio is organized by product capability, not by page size. Keep data contracts and
pure transformations in `packages/video`; keep server communication near feature boundaries; keep
render-only components free of Convex hooks.

## Data flow

```text
route / page shell
  -> feature shell (loads data, owns mutations and draft state)
    -> focused view components (props and callbacks only)
      -> shared UI primitives

packages/video contracts + vocabulary
  -> feature shells and views
  -> Convex jobs and provider adapters
  -> renderer
```

The shell is the integration boundary. It may know about Convex, revisions, jobs and navigation.
Child components should receive typed values and intent-level callbacks such as `onMovement` or
`onSelect`, rather than backend functions.

## Folders

- `story/` contains scene-authoring controls. Story mode is a beat board: every scene
  is readable at a glance, and the form opens on the selected beat. `CameraDirection`
  uses the canonical camera vocabulary from `packages/video/src/camera.ts`. The scene
  rail (`SceneNavigator`) is for Shots, not Story.
- `shots/` contains the start-image library and generated-candidate workflow. `ShotStudio` owns the
  selected shot and composes these focused panels.
- `timeline/` separates pure edit calculations (`model.ts`), local editor history and playback
  hooks, transport, and the track canvas. `TimelineEditor` coordinates them and owns document
  mutations.
- `review/` contains review-only panels. `VideoReview` owns candidate selection, approval and
  feedback state.
- reusable cross-screen utilities such as `useRevisionEditor` stay at this directory level.

## Change rules

1. Add or change domain vocabulary in `packages/video` first. Do not introduce another camera,
   motion, job-state or media-kind list in a component.
2. Normalize historical values when they enter the UI or provider adapter. Persist canonical values
   for new edits. Provider-specific prompt wording belongs in an adapter/helper, not a form.
3. Keep pure timeline math in `timeline/model.ts` and cover edge cases there. UI components should
   translate user gestures into model operations, not reimplement frame arithmetic.
4. Preserve the public props of feature shells when extracting components. This keeps routes and
   tests stable while internals evolve.
5. Prefer intent-level props and focused components over passing a whole controller object. If a
   child starts loading unrelated data or exceeds roughly one screen of code, split it at a product
   boundary.
6. Put shared surface styles in `styles/surfaces/video.css`; put feature-specific rules in
   `video-story.css`, `video-shots.css`, `video-timeline.css`, or `video-review.css`. A selector has
   one owning file.
7. Colocate pure-model tests with the model. Keep feature behavior tests against the public shell so
   refactors remain safe.

## Adding a capability

Start with a contract or canonical vocabulary in `packages/video`, add a focused feature component,
then let the shell connect it to Convex. Keep external providers behind jobs/adapters so replacing a
provider does not rewrite the editor. Validate with the feature test, web typecheck, full web suite,
and production build.
