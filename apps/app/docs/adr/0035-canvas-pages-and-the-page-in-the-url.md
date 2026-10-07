# 35. Canvas pages: a per-person view per page, and the page in the URL

Date: 2026-10-07

Status: Accepted (backfilled 2026-10-07)

## Context

People wanted Figma-style pages inside one canvas for showing different things.
Before pages, each person had their own live camera, and the only shared camera
state was `meta.savedViewport`: where the canvas opened, written by whoever
moved last. Pages raised three questions: whose view a page remembers, where
that's stored, and how to link to a page.

## Decision

- **Pages hold layers only** (spec #1834). Chats, repos, Memory, Files, Skills
  and the Coordinator stay canvas-wide (ADR 0030).
- **Each person has their own view per page**, stored in the canvas doc
  (`pageViews`, keyed by member and page, #1838, PR #1853), so it follows them across
  devices. You open on your last page; the first open fits the first page.
  Views go when the member leaves or the page is deleted.
- **The page is in the URL** as `?page=` (#1836, PR #1852), so a link opens on
  that page.
- **Only the Coordinator edits pages** (#1843): create, rename, delete, move to
  page, like camera control, so agents don't fight. Other chats only take a
  `page` argument.
- **Picking a chat never navigates the canvas.** A layer named in chat on
  another page does switch to it (#1841, PR #1866).

## Consequences

- Two people on one page can be looking at different spots; Follow is how one
  joins another.
- Per-person views add a record per member per page to the canvas doc.
- The old shared `savedViewport` is used once as everyone's starting view.

Rejected: one shared view per page; views stored only in the browser; chats
owned by a page; sections on one canvas instead of pages; a page list only in
the breadcrumb; hiding the Pages header until a second page.
