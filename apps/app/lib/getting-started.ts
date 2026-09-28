import type { BranchData, IframeLayerData, RepoData } from "@/lib/types"

/**
 * The getting-started checklist on the first Canvas after desktop setup
 * (#780): add a Project, start a Workspace, open its frame. Finish on the setup
 * gate makes a Canvas and marks it here; the Canvas shows the checklist until
 * the person dismisses it.
 *
 * Progress is derived, never stored: each step reads the Canvas's own
 * collections, so a step ticks off the moment it happens, whichever surface
 * did it (the checklist, the sidebar, another client).
 */

export type GettingStartedStep = "project" | "workspace" | "frame"

export interface GettingStartedProgress {
  project: boolean
  workspace: boolean
  frame: boolean
  /** The first step not done yet, or null once all three are. */
  current: GettingStartedStep | null
  /** The Workspace step 3 is about: the first one with a frame, else the first. */
  branch: Pick<BranchData, "id" | "status" | "statusMessage" | "error"> | null
  /** That Workspace's frame, if it has one. */
  frameLayerId: string | null
}

export function gettingStartedProgress({
  repos,
  branches,
  iframeLayers,
}: {
  repos: Pick<RepoData, "id">[]
  branches: Pick<BranchData, "id" | "status" | "statusMessage" | "error">[]
  iframeLayers: Pick<IframeLayerData, "id" | "branchId">[]
}): GettingStartedProgress {
  const frameFor = (branchId: string) =>
    iframeLayers.find((l) => l.branchId === branchId) ?? null
  const branch =
    branches.find((b) => frameFor(b.id) !== null) ?? branches[0] ?? null
  const frameLayer = branch ? frameFor(branch.id) : null

  const project = repos.length > 0
  const workspace = branches.length > 0
  // "Open its frame" is done once a frame shows the Workspace's running app.
  const frame = branches.some(
    (b) => b.status === "running" && frameFor(b.id) !== null
  )
  const current: GettingStartedStep | null = !project
    ? "project"
    : !workspace
      ? "workspace"
      : !frame
        ? "frame"
        : null

  return {
    project,
    workspace,
    frame,
    current,
    branch,
    frameLayerId: frameLayer?.id ?? null,
  }
}

/**
 * The Canvas that shows the checklist, kept in this browser's storage: the
 * desktop app has one person, and the checklist is a nudge, so losing it to
 * cleared storage costs nothing.
 */
const STORAGE_KEY = "screenplay:getting-started-canvas"

const listeners = new Set<() => void>()

/** For `useSyncExternalStore`: hear this tab's mark and clear. */
export function subscribeGettingStarted(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function markGettingStartedCanvas(roomId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, roomId)
  } catch {
    // Storage blocked: the Canvas opens with its usual empty state.
  }
  listeners.forEach((l) => l())
}

export function isGettingStartedCanvas(roomId: string): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === roomId
  } catch {
    return false
  }
}

export function clearGettingStartedCanvas(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
  listeners.forEach((l) => l())
}
