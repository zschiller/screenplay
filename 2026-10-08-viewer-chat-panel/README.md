# Viewer chat panel

- **Page:** https://claude.ai/artifact/G6ZFFRb9JEzV31mBDMdTDf
- **Date:** 2026-10-08
- **Issue:** #1933, “Viewers read chats; host-only controls hidden” (spec #1921, Sharing in the Mac app)

## Owner’s words

“Viewers can open every chat and read messages, steps and plans live, but never send. Hidden for viewers and refused by the server: composer, New chat, plan and merge actions, terminals, canvas editing, frame ⋯ actions, settings and copy link. … Starts with a design exploration of the viewer’s chat panel and canvas chrome.”

## Question

With the host-only controls gone, what does a viewer’s chat panel and canvas chrome look like?

## Outcome

One round, three questions. No picks came back before the build, so it shipped each recommended option in #1962:

- Where the composer was: **A, nothing** (B, a muted “Only <host> can send” line, and C, a disabled composer, not taken).
- Plan, question and merge cards: **A, the card without buttons** (B, a “Waiting for <host>” line, not taken).
- View only: **A, no mark** (B, “View only” in the breadcrumb, not taken).

After the merge with viewer comments (#1934), a viewer’s toolbar is Select and Comment.

Never re-offer: none recorded.
