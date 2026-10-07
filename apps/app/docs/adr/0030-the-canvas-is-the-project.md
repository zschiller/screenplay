# 30. The canvas is the project

Date: 2026-09-28

Status: Accepted (backfilled 2026-10-07; desktop account-level repos are the decided direction, see Consequences)

## Context

The hierarchy was Canvas → Project → Workspace → frame. Repos and run settings
lived in a Projects tree in the sidebar, the canvas had its own settings, and
branches were prominent everywhere. Zack asked why project configs live in the
canvas at all, and whether branches should be as hidden as in Claude Projects.

## Decision

- **The canvas is the project** (spec #880). There is no Project level: repos
  and their run settings live in Canvas settings › Repositories (#883, PR
  #892), beside Memory, Files, Skills and Members, with one Coordinator per
  canvas.
- **Run settings stay on the canvas, not in the repo or only on the account.**
  That's what lets every member of a shared canvas run the same thing.
- **Branches are hidden**: chats have titles named by the agent; the branch
  shows only in the hover card and git menus.
- **Account repositories seed canvases** (spec #1420): a canvas switches a
  saved repository on, can customize it locally, and can save back to all.

## Consequences

- Sharing a canvas shares everything needed to run its chats.
- The same repo set up on two canvases is two copies, linked to the account
  record but customizable per canvas.
- Pages (ADR 0035) split a canvas visually without splitting the project.
- On desktop, which has no sharing, repos moving to account level (every canvas
  can use them with no add step) was decided on 2026-10-02 as direction; it
  isn't built.

Rejected: a Project level above or inside the canvas; one repo per canvas;
`screenplay.json` in the repo as the config home; branches as the unit people
see.
