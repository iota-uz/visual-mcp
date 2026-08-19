<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Project posture: green-field

Assume green-field development unless the user explicitly requests compatibility
for a particular change. Do not add legacy adapters, dual reads/writes, schema
fallbacks, or automatic migrations. Prefer the clean target architecture,
remove superseded code, and update all call sites, validators, fixtures, docs,
and tests together. Existing development data may be recreated. Audit trails
are not a product priority; add them only for correctness, security, debugging,
or an explicit user/compliance requirement. See `AGENTS.md` for the full rule.

## Local stack

Do not test against the live deployment and do not ask for a human sign-in.
`npm run dev:agent` brings up an isolated local backend with seed data, then
`http://localhost:5173/dev/sign-in?auto=1` signs you in with one navigation.
See **Local stack** in `AGENTS.md` for the fixture modes and the rules.
