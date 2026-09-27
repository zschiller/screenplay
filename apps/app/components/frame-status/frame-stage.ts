import type { DevServerProbeState } from "@/hooks/use-dev-server-probe"
import type { SandboxStatus } from "@/lib/types"

/**
 * What a frame shows in place of its preview (issue #731), or `null` when the
 * live page is up and nothing should cover it.
 *
 *  - `unassigned`       — no Workspace picked for the frame
 *  - `booting`          — the Workspace's sandbox is being created
 *  - `starting`         — the sandbox is up and its dev server is starting
 *  - `workspace-failed` — the Workspace errored (setup failed, restart failed)
 *  - `preview-failed`   — the Workspace runs but its dev server never answered
 *  - `stopped`          — the Workspace's sandbox is stopped
 */
export type FrameStage =
  | "unassigned"
  | "booting"
  | "starting"
  | "workspace-failed"
  | "preview-failed"
  | "stopped"

export interface FrameStageInput {
  /** The frame's Workspace status, or `undefined` when it has none (or it was deleted). */
  status: SandboxStatus | undefined
  /** Whether the Workspace has a preview URL to load yet. */
  hasPreview: boolean
  /** The dev-server probe for that URL. */
  probe: DevServerProbeState
  /** The bridge reported a real page (`screenplay:ready`). */
  contentReady: boolean
  /** Placeholder recovery reloaded as many times as it's allowed to without a page. */
  recoveryExhausted: boolean
}

/**
 * Resolve the one stage a frame shows. A stopped or errored Workspace covers the
 * frame even if an old page is still painted: its preview is gone or about to
 * be. Otherwise a real page always wins, so a status that lags behind a live
 * dev server never hides it.
 */
export function resolveFrameStage({
  status,
  hasPreview,
  probe,
  contentReady,
  recoveryExhausted,
}: FrameStageInput): FrameStage | null {
  if (!status) return "unassigned"
  if (status === "stopped") return "stopped"
  if (status === "error") return "workspace-failed"
  if (contentReady) return null
  if (status === "creating") return "booting"
  if (status === "starting" || !hasPreview) return "starting"
  if (probe === "timedout" || recoveryExhausted) return "preview-failed"
  return "starting"
}
