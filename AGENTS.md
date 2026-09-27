## Agent skills

### Issue tracker

Issues and specs are tracked as GitHub issues (github.com/zschiller/screenplay), managed via the `gh` CLI. Dependencies between issues are always GitHub native blocking edges ("blocked by"), never prose alone. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, each mapped to its default label string (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context layout: `CONTEXT-MAP.md` at the root points to per-context `CONTEXT.md` files. See `docs/agents/domain.md`.
