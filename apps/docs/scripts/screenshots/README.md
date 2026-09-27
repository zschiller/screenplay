# Docs screenshots

Tooling that regenerates every screenshot in `apps/docs/public/screenshots`
from a real, running Screenplay. It boots the **local (desktop) build** in a
browser with no external services, seeds a demo scene, captures named screens
in light and dark, and frames them.

```bash
pnpm --filter docs screenshots          # boot → seed → capture → frame
pnpm --filter docs screenshots --fresh  # same, from a clean slate
```

Then review the changed images (`git diff --stat apps/docs/public/screenshots`)
and commit them.

## Requirements

- Node 20+, pnpm, git, npm (the demo app installs its own deps)
- Chrome or Chromium. It's found automatically, or set `CHROME_PATH`.
- Linux without a display needs **Xvfb**. Chrome runs headed, because
  headless Chrome reports `(hover: none)`, which hides every hover-revealed
  control in the sidebar.
- Optional: a real `claude` CLI, which the terminal-tab screenshot launches.
  Without it, a stand-in prompt is shown.
- Free ports: `3000` (app), `1234` (local Yjs), `1355` (portless), `9222` (Chrome).

## Steps

| Command | What it does |
| --- | --- |
| `node run.mjs boot [--fresh]` | Starts `apps/app` with the desktop build flags. It uses an isolated `$HOME` and data dir under `$DOCS_SHOTS_DIR` (default `$TMPDIR/screenplay-docs-shots`), and checks out the Northwind demo repo (`fixtures/demo-app`) with a bare `origin`. |
| `node run.mjs seed` | Builds the scene through the UI: the "Northwind marketing site" canvas; three workspaces, one with an agent turn and one with an approved plan; a document with its chat; a tidy layout; three more canvases; folders; pins; a named preset. It records room and branch ids in `state.json`. |
| `node run.mjs capture [group\|scene…] [--theme light\|dark]` | Captures named scenes into `raw/<theme>/<name>.png`. |
| `node run.mjs frame [name,…]` | Frames raw captures into `apps/docs/public/screenshots/<name>.<theme>.webp`. |
| `node run.mjs stop` | Stops the app and the capture browser. |

Scene groups: `home`, `settings`, `canvas`, `frames`, `agent`, `play`.
Re-running `capture` and `frame` for one screen is cheap:

```bash
node run.mjs capture frames && node run.mjs frame knobs-popover,route-picker
```

## How conversations stay deterministic

The agent in the screenshots is **scripted**, not a live model:

- `fixtures/bin/npx` intercepts the launch of Claude Code's ACP adapter
  (`@agentclientprotocol/claude-agent-acp`) and runs `fixtures/scripted-agent.mjs`
  instead. Screenplay's real desktop path (the external engine, ACP streaming,
  the plan-approval gate) is unchanged. The scripted agent really performs its
  file edits and git commands in the workspace, so previews hot-reload and diff
  stats are real.
- `fixtures/bin/claude` answers the `claude -p` calls Screenplay uses to name
  branches and chats, and hands anything else to the real CLI.
- The isolated `$HOME` holds a git identity and a stand-in Claude login
  (`~/.claude.json`), so the first-run gate passes without a real sign-in.

To change what the agent says or does, edit `SCENARIOS` in
`fixtures/scripted-agent.mjs`. Scenarios are matched against the prompt text.

## Adding a screenshot

1. Add a scene to `SCENES` in `capture.mjs`: a function that gets the page
   into shape and calls `shot("<name>")`. The helpers in `lib/browser.mjs`
   cover the common moves (open a room with a camera, toggle panels, open a
   workspace menu, pick a chat target…).
2. Add `"<name>": null` (full window) or `"<name>": [x, y, w, h]` (a detail
   crop in CSS px of the 1280×800 capture) to `manifest.json`.
3. `node run.mjs capture <scene> && node run.mjs frame <name>`
4. Embed it in MDX: `<Screenshot name="<name>" alt="…" />`.

To set a canvas camera precisely, `openRoom(p, roomId, { x, y, zoom })` writes
`meta.savedViewport` into the room's Yjs document before loading. `x`/`y` are
relative to the canvas area, which starts after the 240px sidebar.

## Limits

The local build has no multi-user surface, so there are no screenshots of
comments, remote cursors, following, or the Share dialog. The collaboration
page is text-only for now. Capturing those needs a hosted setup (see
[issue #716](https://github.com/zschiller/screenplay/issues/716), which
generalizes this harness for UI review).
