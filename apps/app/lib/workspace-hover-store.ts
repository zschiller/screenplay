import { useEffect, useSyncExternalStore, type HTMLAttributes } from "react"

/**
 * Workspace ↔ frame hover cross-highlighting (#793). The room sidebar and the
 * Canvas both publish what the pointer is over, and both read it back:
 *
 * - hovering a Workspace row (`source: "workspace"`) outlines that Workspace's
 *   frames on the Canvas and highlights their rows in the layer list;
 * - hovering a frame, in the layer list or on the Canvas (`source: "frame"`),
 *   highlights its Workspace row. Its sibling frames stay as they are;
 * - hovering a Workspace row also lights up the rows of the Groups on it
 *   (#872), and hovering a Group row or its Workspace pill (`source:
 *   "group"`) lights up that Workspace row.
 *
 * Every key is a **Branch id** (a Workspace's id, an Iframe Layer's
 * `branchId`, and a Group's Workspace from `groupBranchId`).
 */
export interface WorkspaceHover {
  branchId: string
  source: "workspace" | "frame" | "group"
}

let current: WorkspaceHover | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export const workspaceHoverStore = {
  get(): WorkspaceHover | null {
    return current
  },
  set(next: WorkspaceHover): void {
    if (current?.branchId === next.branchId && current.source === next.source)
      return
    current = next
    emit()
  },
  /** Clear the hover, but only if it is still the one `prev` set, so moving
   *  straight from one row to another (enter before leave) keeps the newer
   *  hover. */
  clear(prev: WorkspaceHover): void {
    if (current?.branchId !== prev.branchId || current.source !== prev.source)
      return
    current = null
    emit()
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

const getServerSnapshot = () => null

/** The current hover. Re-renders on every change, so prefer the narrower
 *  hooks below in rows. */
export function useWorkspaceHover(): WorkspaceHover | null {
  return useSyncExternalStore(
    workspaceHoverStore.subscribe,
    workspaceHoverStore.get,
    getServerSnapshot
  )
}

/** True while a frame or Group on this Workspace is hovered (its row lights
 *  up). */
export function useIsWorkspaceHighlighted(branchId: string): boolean {
  const read = () => {
    const h = workspaceHoverStore.get()
    return !!h && h.source !== "workspace" && h.branchId === branchId
  }
  return useSyncExternalStore(workspaceHoverStore.subscribe, read, () => false)
}

/** True while this frame's (or Group's) Workspace row is hovered (the row
 *  lights up). */
export function useIsFrameHighlighted(branchId: string | undefined): boolean {
  const read = () => {
    const h = workspaceHoverStore.get()
    return !!branchId && h?.source === "workspace" && h.branchId === branchId
  }
  return useSyncExternalStore(workspaceHoverStore.subscribe, read, () => false)
}

/** The Workspace whose row is hovered, or null. Frame hovers don't count, so a
 *  frame on the Canvas never outlines its siblings. */
export function useHoveredWorkspaceId(): string | null {
  const read = () => {
    const h = workspaceHoverStore.get()
    return h?.source === "workspace" ? h.branchId : null
  }
  return useSyncExternalStore(workspaceHoverStore.subscribe, read, () => null)
}

/** Pointer handlers that publish a hover of `source` on this Workspace while
 *  the pointer is over the element, and clear it if the element unmounts
 *  mid-hover (deleted, collapsed). Empty when there is no Workspace. */
export function useWorkspaceHoverProps(
  branchId: string | undefined,
  source: WorkspaceHover["source"]
): Pick<HTMLAttributes<Element>, "onPointerEnter" | "onPointerLeave"> {
  useEffect(() => {
    if (!branchId) return
    return () => workspaceHoverStore.clear({ branchId, source })
  }, [branchId, source])
  if (!branchId) return {}
  return {
    onPointerEnter: () => workspaceHoverStore.set({ branchId, source }),
    onPointerLeave: () => workspaceHoverStore.clear({ branchId, source }),
  }
}
