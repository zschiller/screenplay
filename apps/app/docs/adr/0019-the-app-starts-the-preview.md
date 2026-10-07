# 19. The app, not the model, starts the preview; the agent starts once code is checked out

Date: 2026-10-05

Status: Accepted (backfilled 2026-10-07)

## Context

A repo chat needs three things before it is useful: the code checked out, its
dependencies installed, and the preview (dev server) running. Install and the
first dev-server start take the longest. Until PR #1711 the agent waited for
all three, so a new chat sat idle while `pnpm install` ran.

Every repo chat also gets a frame at once. If the model decided when to start
the preview, a frame could stay blank for as long as the model chose not to
(or forgot to) start it.

## Decision

- **The agent starts as soon as code is checked out** (PR #1711). Every new
  repo chat (New chat, frame ask, drawn Mockup, Coordinator `start_chat`)
  provisions through `onCodeReady`: after clone and git config the server
  marks the Branch `codeReady` (`markCodeReady` in `lib/sandbox/lifecycle.ts`)
  and `agentCanStart` lets the first prompt through. Install and the preview
  carry on in the background. Early turns carry a setup note telling the model
  not to install, build, test or preview until the dev-server logs say it is
  running.
- **The app starts install and the preview, never the model.** The model can
  read the logs and restart, stop or start the dev server it already has, but
  starting it the first time is the app's job.
- **Restart and Recreate follow the same rule** (PR #1741): Restart sandbox,
  Recreate, the reconnect fallback and local Start all mark `codeReady` as soon
  as the checkout is there.

## Consequences

- A chat answers within seconds of creation; its frame fills in when the
  preview comes up, with no model turn in between.
- Frames still wait for the sandbox to be `running`; only the agent is let in
  early.
- The model can run a command that needs installed dependencies too soon. The
  setup note is the guard, not a hard block.

Rejected: the model starting install and the preview itself (frames could stay
blank; Zack picked "App, plus Recreate", 2026-10-05); holding the agent until
the preview is running (the old behaviour, slow on every new chat).
