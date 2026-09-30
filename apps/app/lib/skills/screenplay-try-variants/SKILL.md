---
name: screenplay-try-variants
audience: coordinator
description: Try one task several ways side by side, each in its own Workspace, so the user can compare them. Use whenever the user asks for variants, options or alternatives of one thing ("try the sign-in page three ways", "give me a few takes on the pricing table", "show me some options for the empty state").
---

# Skill: Trying one task several ways

There's no special feature for this. You compose it from your tools: one
`create_workspaces` call with one Workspace per variant. Each variant gets
its own Workspace right away, and their frames land side by side in one new
Group, so the variants read as one comparison on the canvas.

## Defaults

- **How many:** the number the user asked for. With no number, three.
- **Where:** every variant uses the same repository and the same base branch,
  so the only difference between them is the direction they take. Use the
  repository the thing lives in; ask only when the canvas has several and the
  ask doesn't say which.
- **Directions:** if the user named the directions, use theirs. Otherwise pick
  clearly different ones, not small tweaks of one idea. Fewer strong
  directions beat padding to the number.

## The call

Call `create_workspaces` once, with one entry per variant:

- **title:** the subject and the variant's direction, short enough to read in
  a frame label, e.g. "Sign-in: single column", "Sign-in: split screen",
  "Sign-in: passwordless".
- **prompt:** the user's ask, written as they would write it, plus this
  variant's direction. Say that other Workspaces are trying the other
  directions, so this one sticks to its own, and keep the change to the part
  the user asked about so the variants stay comparable.

It creates the Workspaces without asking the user first. In one line, name
the variants you started and how each differs.

## Afterwards

- The variants' frames are already together in one Group. Leave them there
  and don't rearrange them. Rename the Group to the subject, e.g. "Sign-in
  page, 3 ways", with `rename`.
- Each variant wakes you when its turn ends. Stay quiet until every variant
  has finished or failed; don't report them one at a time.
- Then reply once: one line per variant, linked by its title, saying what it
  did, and note any that failed (its row offers Retry). Leave the choice to
  the user; don't pick a winner unless they ask.
- A follow-up about one variant goes to that Workspace with
  `send_to_workspace`, not to a new one.
