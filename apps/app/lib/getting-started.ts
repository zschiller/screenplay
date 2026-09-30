import type { BranchData, RepoData } from "@/lib/types"

/**
 * The getting-started checklist on the first Canvas after desktop setup (#780,
 * reworked for the Coordinator in #1182): add a repository, ask the
 * Coordinator for a change, open the Workspace it ran in. Finish on the setup
 * gate makes a Canvas and marks it here; the Canvas shows the checklist until
 * the person dismisses it.
 *
 * Progress is derived, never stored in the checklist: the first two steps read
 * the Canvas's own collections, so a step ticks off the moment it happens,
 * whichever surface did it (the checklist, the panel, another client). Opening
 * a Workspace happens in this browser's panel, so the Canvas passes it in
 * ({@link markGettingStartedWorkspaceOpened}).
 */

export type GettingStartedStep = "project" | "ask" | "open"

type ProgressBranch = Pick<
  BranchData,
  "id" | "status" | "statusMessage" | "error" | "lastActivityAt" | "pendingSeed"
>

export interface GettingStartedProgress {
  project: boolean
  ask: boolean
  open: boolean
  /** The first step not done yet, or null once all three are. */
  current: GettingStartedStep | null
  /** The Workspace the first ask went to, which step 3 opens. */
  branch: ProgressBranch | null
}

/** Whether a Workspace has been asked for something: a turn, or one queued. */
function asked(branch: ProgressBranch): boolean {
  return !!branch.lastActivityAt || !!branch.pendingSeed
}

export function gettingStartedProgress({
  repos,
  branches,
  workspaceOpened,
}: {
  repos: Pick<RepoData, "id">[]
  branches: ProgressBranch[]
  /** Whether this browser's panel has shown a Workspace on the Canvas. */
  workspaceOpened: boolean
}): GettingStartedProgress {
  const branch = branches.find(asked) ?? null

  const project = repos.length > 0
  const ask = branch !== null
  const open = workspaceOpened
  const current: GettingStartedStep | null = !project
    ? "project"
    : !ask
      ? "ask"
      : !open
        ? "open"
        : null

  return { project, ask, open, current, branch }
}

/**
 * The Canvas that shows the checklist, kept in this browser's storage: the
 * desktop app has one person, and the checklist is a nudge, so losing it to
 * cleared storage costs nothing.
 */
const STORAGE_KEY = "screenplay:getting-started-canvas"
/** The Canvas whose panel has shown a Workspace, for step 3 (#1182). */
const OPENED_KEY = "screenplay:getting-started-opened"

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
    localStorage.removeItem(OPENED_KEY)
  } catch {
    // Nothing to clear.
  }
  listeners.forEach((l) => l())
}

export function markGettingStartedWorkspaceOpened(roomId: string): void {
  if (isGettingStartedWorkspaceOpened(roomId)) return
  try {
    localStorage.setItem(OPENED_KEY, roomId)
  } catch {
    // Storage blocked: step 3 stays open until the checklist is dismissed.
  }
  listeners.forEach((l) => l())
}

export function isGettingStartedWorkspaceOpened(roomId: string): boolean {
  try {
    return localStorage.getItem(OPENED_KEY) === roomId
  } catch {
    return false
  }
}
