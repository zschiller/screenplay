# 20. Agents merge only through a card a person presses, and write to GitHub only when asked

Date: 2026-10-05

Status: Accepted (backfilled 2026-10-07)

## Context

PR #1707 gave in-product agents GitHub tools: search, read and create issues,
comment, update, link with native blocking edges and sub-issues, list labels,
read PR diffs and checks. PR #1727 added `review_pr` and `merge_pr`. Merging is
the one action that can't be taken back in practice: it lands on the default
branch, may deploy, and is credited to whoever's token ran it.

## Decision

- **`merge_pr` never merges.** It shows a card with the PR's checks and a Merge
  button; the merge happens only when a member presses it, with their own
  GitHub account (`lib/agent/github-tools.ts`, `components/agent/merge-pr-card.tsx`).
  The tool is annotated read only for that reason.
- **The card is shadcn AI Elements Confirmation** (`packages/ui/src/components/confirmation.tsx`),
  the pattern for any card where an agent wants a person to act.
- **Agents write to GitHub only when asked.** Prompts say so; tools run with
  the turn's member token (hosted OAuth, `gh` on the Mac); turns with no
  sender (Coordinator wakes) get read-only GitHub tools. Only the canvas's
  repos are reachable.

## Consequences

- An agent can do everything up to the merge, and a person is always the one
  who lands it.
- A merge started by an agent waits until someone opens the chat. The agent
  learns the result only by reading the PR again.
- GitHub attribution stays with the person, not a bot account.

Rejected: agents merging directly when asked in chat; read-only GitHub access
(the first card's recommended option, superseded when review and merge were
built); ChatDisclosure-with-buttons and radio question-card looks for the
confirm ("looks weird").
