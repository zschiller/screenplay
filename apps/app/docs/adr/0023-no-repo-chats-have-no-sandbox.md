# 23. A chat with no repo has no sandbox and makes only Mockups and Documents

Date: 2026-10-02

Status: Accepted (backfilled 2026-10-07)

## Context

A new canvas has no repo, but people still want to sketch: Mockups and
Documents. Two ways to support that: give the chat a scratch sandbox with no
repo and let it write code there, or give it no sandbox at all.

## Decision

- **A chat with no repo is a `sketch` chat** (`ChatSessionData.target`, PR
  #1409). It has no sandbox, no branch and no preview, and makes and edits only
  Mockups and Documents.
- **The Frame tool is off with no repo**, in the toolbar, on F and in the empty
  state, with a tooltip saying frames run your app from a repository.
- **On canvases with repos, a new chat can still pick No repository**; the
  default stays the last-used repo.
- **Adding a repo only adds it**: no Workspace or frame appears on its own.

## Consequences

- No code exists outside a repo, so nothing needs a home later. Code-shaped
  ideas on a no-repo canvas are Mockups.
- A sketch chat is cheap: no VM, no install.
- A chat that later needs code has to be a new chat on a repo.
- One sandbox holding zero or more repos is a possible later spec, not part of
  this decision.

Rejected: repo-less code in a scratch sandbox ("too fragile"); the Coordinator
writing Mockups itself on a no-repo canvas (ADR 0021).
