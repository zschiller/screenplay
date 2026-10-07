# 32. Design templates are userland inside skills; a page answers a question card or drafts into the composer, never sends on its own

Date: 2026-10-04

Status: Accepted (backfilled 2026-10-07)

## Context

The built-in design skills (exploration, audit, storybook) make pages: options
side by side, picks, notes. The question was where Screenplay's native UI ends
and the agent-drawn Mockup begins, and how a pick on a page gets back to the
chat. Options ranged from pictures only (picks made in native UI) to a native
Exploration layer type.

## Decision

- **Templates are userland, inside the skill** (spec #1641). A design skill
  carries its page template as skill files (#1642); people can copy and change
  the skill. No native Exploration layer.
- **Mockups point at skill files** (`skill:`/`files:` refs resolved to `blob:`,
  #1643) instead of inlining big templates, so Mockups stay small in the room
  doc.
- **A page talks back two ways only** (#1644, #1645): it answers an open
  question card tied to the Mockup (`screenplay.answer`), or drafts text into
  the composer (`screenplay.draft`) for the person to send. A fixed, labelled
  choice sends at once; open-ended text is drafted.
- **Templates keep Screenplay's own look**; customizing means copying the
  skill.

## Consequences

- The model chooses per take whether to draw Mockups or a page; the defaults
  ship and anyone can change them.
- A page can never post a message on its own; the person is always the sender.

Rejected: pictures only with picks on labels; a native Exploration layer (folded
into the template); a page posting messages itself; the agent reading page
state as the only path; swapping in the repo's tokens or a shared stylesheet.
