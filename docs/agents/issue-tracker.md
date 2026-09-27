# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

## Blocking edges

Every dependency between issues is a GitHub **native issue dependency** ("blocked by" / "blocking"), never only prose. The native edge is the source of truth: it shows in the GitHub UI and drives `issue_dependencies_summary.blocked_by`, the live count of open blockers. This applies to every skill that creates issues, and is mandatory for `/to-tickets` and `/to-spec`.

- **Add an edge** (`<n>` is blocked by `<blocker>`):
  ```sh
  BLOCKER_ID=$(gh api repos/{owner}/{repo}/issues/<blocker> --jq .id)
  gh api --method POST repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by -F issue_id="$BLOCKER_ID"
  ```
  `issue_id` is the blocker's numeric **database id** (`.id`), _not_ its `#number` or `node_id`. When calling the REST API without `gh`, send the body as JSON with `Content-Type: application/json`.
- **List an issue's blockers**: `gh api repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by --jq '[.[] | {number, state}]'`. Its dependents: the same path ending in `/blocking`.
- **Remove an edge**: `gh api --method DELETE repos/{owner}/{repo}/issues/<n>/dependencies/blocked_by/<blocker-db-id>`.
- **Is it unblocked?** An issue is unblocked when every blocker is closed (`gh api repos/{owner}/{repo}/issues/<n> --jq .issue_dependencies_summary.blocked_by` is `0`).

Rules:

- **Create blockers first**, then dependents, so every edge can point at a real issue. Wire the edges straight after creating the issues, in the same session.
- **Keep a `## Blocked by` section in the body** listing the same `#<n>` references (or "None (can start immediately)") as a human-readable mirror, but the native edge is what counts. When you change one, change the other.
- **`/to-tickets`**: every "Blocked by" edge the user approved becomes a native edge. After publishing, list each ticket's `dependencies/blocked_by` and confirm it matches the approved breakdown before reporting done.
- **`/to-spec`**: if the spec depends on existing open issues, add them as native blockers of the spec; if existing issues are waiting on it, add the spec as their blocker. When `/to-tickets` later breaks the spec down, wire the tickets' edges among themselves (the spec itself stays unmodified, per `/to-tickets`).
- **If an edge can't be added** (API error, permissions), stop and tell the user which edge failed and why. Don't silently fall back to prose-only edges.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue, then wire its blocking edges as described in **Blocking edges**.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`, and `gh api repos/{owner}/{repo}/issues/<number>/dependencies/blocked_by` for its blockers.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: native issue dependencies, exactly as in **Blocking edges** above.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
