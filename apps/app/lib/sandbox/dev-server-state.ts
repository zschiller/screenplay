import type { BranchData } from "@/lib/types"

/**
 * Dev Server State (#1342) — what a Workspace's dev server is doing, as the
 * Terminal Pane's dot shows it, in the footnote and on the Dev server tab:
 *
 *  - `running` — the Sandbox runs and the preview answers (or hasn't had the
 *    chance to fail yet);
 *  - `stopped` — someone stopped it ({@link BranchData.devServerStoppedAt}),
 *    or the whole Sandbox is stopped;
 *  - `crashed` — the Sandbox runs, nobody stopped the dev server, but the
 *    preview keeps failing its probe; or the Workspace errored;
 *  - `starting` — the Sandbox is still being created or started.
 *
 * The stop is shared through the doc and every member probes the same preview,
 * so everyone in the Room sees the same state. React-free.
 */
export type DevServerState = "starting" | "running" | "stopped" | "crashed"

export function resolveDevServerState(
  agent: Pick<BranchData, "status" | "devServerStoppedAt">,
  previewFailing: boolean
): DevServerState {
  switch (agent.status) {
    case "creating":
    case "starting":
      return "starting"
    case "stopped":
      return "stopped"
    case "error":
      return "crashed"
    case "running":
      if (agent.devServerStoppedAt) return "stopped"
      return previewFailing ? "crashed" : "running"
  }
}

/**
 * Whether the dev server can be controlled at all: only inside a running
 * Sandbox (a stopped one is started from the Workspace, not here).
 */
export function canControlDevServer(
  agent: Pick<BranchData, "status">
): boolean {
  return agent.status === "running"
}

/**
 * The preview health watch behind `crashed`, as a reducer over probe results:
 * {@link FAILURES_TO_CRASH} failed probes in a row are a crash. A fresh launch
 * ({@link BranchData.devServerLaunchedAt}, written by Run, Restart and the
 * chat's tools) gets a grace period first: until the preview has answered, or
 * {@link STARTUP_GRACE_MS} after the launch, failures don't count (a cold first
 * compile can hold the first request for a while). The launch time is shared
 * through the doc, so every member grants the same grace.
 */
export interface PreviewHealth {
  graceUntil: number
  answeredOnce: boolean
  failuresInARow: number
  failing: boolean
}

export const STARTUP_GRACE_MS = 60_000
export const FAILURES_TO_CRASH = 2

export function startPreviewHealth(launchedAt?: number): PreviewHealth {
  return {
    graceUntil: launchedAt ? launchedAt + STARTUP_GRACE_MS : 0,
    answeredOnce: false,
    failuresInARow: 0,
    failing: false,
  }
}

export function nextPreviewHealth(
  health: PreviewHealth,
  answered: boolean,
  now: number
): PreviewHealth {
  if (answered) {
    return { ...health, answeredOnce: true, failuresInARow: 0, failing: false }
  }
  const failuresInARow = health.failuresInARow + 1
  const failing =
    failuresInARow >= FAILURES_TO_CRASH &&
    (health.answeredOnce || now >= health.graceUntil)
  return { ...health, failuresInARow, failing }
}
