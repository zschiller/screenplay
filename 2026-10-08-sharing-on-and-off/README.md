# Sharing on and off

- Page: https://claude.ai/artifact/4HwEfNFCJ48PVzifAj5EsM
- Date: 2026-10-08
- Issue: #1953 (spec #1921)
- Question: Where does the owner turn Sharing on and copy a canvas's link, and what does a viewer see when it's off or the Mac is away?
- Outcome: Built in #1960: a Share button and Share dialog in the Mac app's canvas.

## Record (topic file at the end of the work)


- Owner's words (issue #1953, spec #1921): "The owner's side of Sharing in the Mac app: turning it on and off, copying a canvas link, and what viewers see when it's off or the Mac sleeps or goes offline. ... Starts with a design exploration of where Sharing lives and the offline state."
- Question: Where does the owner turn Sharing on and copy a canvas's link, and what does a viewer see when it's off or the Mac is away?
- Page: https://claude.ai/artifact/4HwEfNFCJ48PVzifAj5EsM (round 1, 2026-10-08)

## Today (measured, main at 9b534d6)
- No UI turns Sharing on; viewer listener only from an unset config. No way to copy a canvas link.
- Hosted: filled Share button in the canvas top-right pill + Share dialog (share-room-dialog.tsx); hidden on Mac (canvas.tsx multiUserSurface).
- Mac top-right pill: zoom menu + chat toggle. Settings: 8 sections.
- Viewer whose host leaves: canvas freezes silently; y-websocket reconnects on its own.

## Round 1
- Where: A Share button + dialog with switch, link, Copy link (recommended); B Settings section + Copy link in breadcrumb ⋯; C Settings switch + Share button that copies with a toast.
- Away: A notice in viewer breadcrumb; B full screen like the refused page, canvas kept underneath (recommended); C dimmed canvas + card.
- Picks: pending (decision cards in the thread). Building the recommended options meanwhile.
- Never re-offer: none yet.
- Captures: `pnpm screenshots:shots --label today --screens canvas,settings`, cropped with PIL; options are html wireframes.

## Scratch

The capture scripts and patches are in `scratch/`.
