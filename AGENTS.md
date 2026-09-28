## Agent skills

### Issue tracker

Issues and specs are tracked as GitHub issues (github.com/zschiller/screenplay), managed via the `gh` CLI. Dependencies between issues are always GitHub native blocking edges ("blocked by"), never prose alone. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, each mapped to its default label string (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout: `CONTEXT-MAP.md` at the root points to per-context `CONTEXT.md` files. See `docs/agents/domain.md`.

### Product docs

The user and self-hosting docs live in `apps/docs/content`. A PR that changes what a user sees or configures updates the page that describes it in the same PR. If no page needs to change, the PR description says why on a `Docs: <reason>` line (see `.github/pull_request_template.md`); the Docs check fails on a product-code PR with neither. A new environment variable goes in `self-hosting/environment-variables.mdx` (`apps/app/test/env-docs.test.ts` enforces it). Screenshots refresh themselves after merge (`.github/workflows/docs-screenshots.yml`); new screens are added in `apps/app/screenshots/docs/`.
