# Context Map

The screenplay monorepo's bounded contexts and where their domain language
lives. Each context owns a `CONTEXT.md` glossary; system-wide architectural
decisions live in `docs/adr/`, context-scoped ones in `<context>/docs/adr/`.
(See `docs/agents/domain.md` for how the engineering skills consume these.)

## Contexts

- [apps/app](./apps/app/CONTEXT.md) — the collaborative canvas and agent runtime
  (rooms, layers, groups, chat targets, tools, agent runs).

_Other workspaces (`apps/docs`, `packages/*`) don't have a `CONTEXT.md` yet;
add one lazily when its domain terms first get resolved._
