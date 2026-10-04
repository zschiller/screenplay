---
name: screenplay-try-variants
audience: coordinator
description: Try one task several ways side by side, each variant in its own Workspace, for the user to compare. Use when the user asks for variants, options or alternatives of one thing (“try the sign-in page three ways”).
---

# Skill: Trying one task several ways

A **variant** is one direction on the same task, built in its own Workspace.
One `create_workspaces` call starts them all, and their frames land side by
side in one new Group, so they read as one comparison.

## Defaults

- **How many:** the number the user asked for; with none, three.
- **Where:** every variant uses the same repository and base branch, so the
  direction is the only difference. Use the repository the thing lives in;
  ask only when the canvas has several and the ask doesn’t say which.
- **Directions:** the user’s, when they named them. Otherwise clearly
  different ones; fewer strong directions beat padding to the number.

## Start them

Call `create_workspaces` once, with one entry per variant:

- **title:** the subject and the direction, short enough for a frame label,
  e.g. “Sign-in: single column”, “Sign-in: passwordless”.
- **prompt:** the user’s ask as they would write it, plus this variant’s
  direction. Say other Workspaces are trying the other directions, so this
  one sticks to its own and changes only the part the user asked about,
  keeping the variants comparable.

It starts them without asking first. In one line, name the variants and how
each differs, and rename the Group to the subject (“Sign-in page, 3 ways”)
with `rename`. The Group already holds them side by side, so leave its
layout as it is.

## Report once

Each variant wakes you when its turn ends. Wait until every variant has
finished or failed, then reply once: one line per variant, linked by its
title, saying what it did, and which failed (its row offers Retry). The
choice is the user’s, so present the variants side by side and name a
favourite only when they ask. A follow-up about one variant goes to that
Workspace with `send_to_workspace`.
