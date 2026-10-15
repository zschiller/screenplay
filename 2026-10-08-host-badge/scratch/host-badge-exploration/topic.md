# Host badge exploration (#1932)

## Owner's words

#1932, "Viewer watches a canvas live", under spec #1921 "Sharing in the Mac app": "A viewer opens a canvas's secret link (one per canvas, no reset, no viewer home screen) on the viewer listener and watches live: canvas, presence and a Host badge. … Starts with a design exploration of the Host badge."

The spec's open question: "The refused page, the Host badge, the viewer's chat panel and canvas chrome." The chat panel and canvas chrome belong to #1933 and are out of scope here.

## Question

How does a viewer watching a shared canvas tell which person is the host among the people present?

## Artifact

https://claude.ai/artifact/CoSxWwRoeq5o1cB96aa4Ta (round 1, 2026-10-08)

## Today (measured)

- No presence marks a host yet. `CanvasPresence` is in `lib/yjs/react.ts:338`. The server will stamp `host` on each presence.
- Cursor tag (`components/canvas/cursors.tsx`): 20px tall, 12px text, black ink on the presence colour. "Maya Chen" is 74px wide. A tag is drawn only while that person's pointer is on your page.
- The Pages panel row avatars (`components/panels/page-people.tsx`, #1840) measure 24px, overlap 4px, show at most 3 and then +N. They have no tooltip; the names are only in the aria-label.
- The top-right pill on desktop holds only the zoom menu and the chat toggle. The facepile (`FollowingToolbar`) is gated by `multiUserSurface` (`canvas.tsx:3270`).
- The breadcrumb pill is 36px tall and 239px wide.

## Round 1 options

- **A (recommended): "Host" in the host's cursor tag.** The tag reads "Maya Chen | Host": a hairline in the tag's ink, then "Host" in medium weight. It grows from 74px to 113px. Cost: it only shows while the host's pointer is on the canvas page you're on, so it is gone while the host is in the chat panel.
- **B: Badge in the Pages panel.** The host's page-row avatar gets a 14px AvatarBadge-style mark (primary fill, HouseSimple Bold glyph) and moves to the end of the stack. A tooltip reads "Maya Chen (host), Ben Okafor". Cost: it needs the viewer to keep the Pages panel (#1933), adds a new tooltip, and uses AvatarBadge at 14px rather than its stock 8 to 12px.
- **C: Facepile in the top-right pill.** This is the hosted `FollowingToolbar`, with the host badged and the tooltip "Follow Maya Chen (host)". Cost: it turns the facepile on for desktop viewers (new chrome, #1933) and makes the pill 70px wider.
- **D: "Hosted by Maya Chen" in the breadcrumb pill.** It adds a hairline, a 20px avatar and 13px text. Cost: the pill grows from 239px to 416px, and the name connects to the host's cursor only through colour.

Recommendation: A. It is the smallest change: the label goes inside the name tag that every build already draws, so it needs no chrome decision from #1933. If #1933 gives viewers a facepile, C is its natural partner.

## Feedback, picks and never-re-offer

None yet. Round 1 is awaiting the owner.

## How the captures were made

- Harness: `apps/app/screenshots`, default desktop profile (port 3947), Checkout canvas, 1512×982 @2x, light and dark. Chromium comes from `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`.
- Scratch screen `host-badge.ts`, copied into `apps/app/screenshots/screens/scratch/`. It uses `page.routeWebSocket` to pass the Yjs socket through and broadcasts fake awareness entries for Maya Chen (host, #FF8506) and Ben Okafor (viewer, #49A9FF), renewed every 8s with an `unref`'d timer. A probe peer at canvas (0,0) maps screen positions to canvas positions. `EXPLORE_OPT=today|a|b|c|d` picks which CSS and JS to inject, `EXPLORE_HOST_AWAY=1` sets the host's pointer to null, and `EXPLORE_DUMP` writes boxes as JSON.
- `run.sh <worktree>/apps/app <dump-dir> today today-away a a-away b c d` shoots each set under the label `hb_<name>`. `crop.py <captures> <out>` makes the close-ups (CSS-px regions, ×2) and half-size full shots.
- `head.part` is the page's data block. Concatenate it with the template's built part (`exploration-template.html` from line 42 on) to rebuild the page.
- No app code was changed.
- Notes:
  - The tooltip mock has no arrow. An injected arrow element never painted, and the cause wasn't found.
  - The canvas group label "Checkout ○ Checkout polish" sits under the breadcrumb pill at the fixture's saved viewport. That is main's behaviour, so the D crop stops above it.
