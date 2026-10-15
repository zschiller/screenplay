# Viewer chat panel exploration (#1933)

## Owner's words
#1933 "Viewers read chats; host-only controls hidden", under spec #1921 Sharing in the Mac app: "Viewers can open every chat and read messages, steps and plans live, but never send. Hidden for viewers and refused by the server: composer, New chat, plan and merge actions, terminals, canvas editing, frame ⋯ actions, settings and copy link. … Starts with a design exploration of the viewer's chat panel and canvas chrome."

## Question
With the host-only controls gone, what does a viewer's chat panel and canvas chrome look like?

## Artifact
https://claude.ai/artifact/G6ZFFRb9JEzV31mBDMdTDf (round 1, 2026-10-08)

## Round 1
Every option hides the issue's list. Three questions:
- Where the composer was: A nothing (recommended), B one muted line "Only <host> can send in this chat.", C disabled composer.
- Plan, question, merge cards: A card without buttons (recommended), B "Waiting for <host> to approve" line.
- View only: A no mark (recommended), B "View only" with Eye icon in the breadcrumb pill.

## Picks, feedback, never re-offer
Pending. The build proceeds on the recommended options: PR https://github.com/zschiller/screenplay/pull/1962.

## Captures
Scratch screen `viewer-chat.ts` + `viewer-chat-tag.js` (copy into apps/app/screenshots/screens/scratch/), `run.sh <apps/app> <dump-dir> label=opts ...` with opts today|q1a|q1b|q1c|q2b|q3b. The tag script is read as a string because tsx's `__name` helper breaks functions passed to page.evaluate. Label-based controls are hidden by CSS selectors, since React remounts drop data- attributes. `head.part` + exploration-template.html from line 42 rebuilds the page.

## Real viewer captures
A production desktop build (`next build` with the harness profile env) served by `startFrontServer` with a viewer listener on 3960. A stand-in `tailscale serve` proxy on 3961 adds the tailscale-user-* headers, because Playwright's extraHTTPHeaders don't reach WebSocket handshakes. The scratch screen `viewer-1933.ts` points at 3961.

## Archive
Merged in #1962 with the recommended options. Archived at claude/design-archive: 2026-10-08-viewer-chat-panel/.
