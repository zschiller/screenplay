import { useSyncExternalStore } from "react"

/**
 * The Workspaces with a pull request being created right now. Create pull
 * request lives in two places (the Workspace menu and the chat header's
 * button) that run the same server action; both read this one set, so either
 * shows the create in progress and neither can start a second one for the
 * same Workspace. Keys are Branch ids.
 */
const pending = new Set<string>()
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export const creatingPrStore = {
  has(branchId: string): boolean {
    return pending.has(branchId)
  },
  /**
   * Runs `create` for the Workspace unless one is already running, keeping
   * the Workspace pending until it settles. Resolves undefined when it was
   * already pending.
   */
  async run<T>(branchId: string, create: () => Promise<T>) {
    if (pending.has(branchId)) return undefined
    pending.add(branchId)
    emit()
    try {
      return await create()
    } finally {
      pending.delete(branchId)
      emit()
    }
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** True while a pull request is being created for this Workspace. */
export function useIsCreatingPr(branchId: string): boolean {
  return useSyncExternalStore(
    creatingPrStore.subscribe,
    () => creatingPrStore.has(branchId),
    () => false
  )
}
