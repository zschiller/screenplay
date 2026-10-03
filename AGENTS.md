## Agent skills

### Issue tracker

Issues and specs are tracked as GitHub issues (github.com/zschiller/screenplay), managed via the `gh` CLI. Dependencies between issues are always GitHub native blocking edges ("blocked by"), never prose alone. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, each mapped to its default label string (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout: `CONTEXT-MAP.md` at the root points to per-context `CONTEXT.md` files. See `docs/agents/domain.md`.

### Product docs

The user and self-hosting docs live in `apps/docs/content`. A PR that changes what a user sees or configures updates the page that describes it in the same PR. If no page needs to change, the PR description says why on a `Docs: <reason>` line (see `.github/pull_request_template.md`); the Docs check fails on a product-code PR with neither. A new environment variable goes in `self-hosting/environment-variables.mdx` (`apps/app/test/env-docs.test.ts` enforces it). Screenshots refresh themselves after merge (`.github/workflows/docs-screenshots.yml`); new screens are added in `apps/app/screenshots/docs/`. Diagrams are SVG components drawn with the kit in `apps/docs/components/diagram/kit.tsx` (see its header), never ASCII in a code block.

Homepage and docs copy uses curly apostrophes and quotes (’ “ ” ‘), never straight ' and ". `pnpm --filter docs test` and `pnpm --filter homepage test` fail on a straight one in prose; add `-- --fix` to curl them (`packages/smart-quotes`).

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
