# Server-side image generation for Claude Code

Use the connected Canvas image-generation tool as advertised by the MCP catalog.
It uses server-owned credentials; never retrieve/store API keys in the harness.
Use the supported image-2.5 family model and capability constraints returned by
the server. Preserve exact model IDs, reference roles, requested count, background
and output format. Do not silently substitute a different provider/model.

Read project/script/keyframe refs and current revisions first. For each keyframe,
state composition, subject/identity, lighting, visual continuity and intended
shot role. Keep text/UI requiring exact spelling in Remotion unless image text is
deliberately part of the art. Pin reference assets to immutable revisions and
keep their roles explicit; external assets need use rights.

Submit only with explicit paid-call authority. Poll the original job; unknown
dispatch cannot be repeated with a new key. Returned assets are candidates until
ingestion is ready and the agent deliberately patches the chosen keyframe ref.
Inspect the actual image before claiming identity/style compliance. Record the
new operation and reason when changing a prompt, reference or model.
