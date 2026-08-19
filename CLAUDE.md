<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

## Local stack

Do not test against the live deployment and do not ask for a human sign-in.
`npm run dev:agent` brings up an isolated local backend with seed data, then
`http://localhost:5173/dev/sign-in?auto=1` signs you in with one navigation.
See **Local stack** in `AGENTS.md` for the fixture modes and the rules.
