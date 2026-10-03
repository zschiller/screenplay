import { useCallback } from "react"
import { toast } from "sonner"

import { startWorkspace } from "@/lib/branch/recovery"
import { isLocalBuild } from "@/lib/local-mode"
import type { BranchData } from "@/lib/types"
import { useRoomId } from "@/lib/yjs/context"
import { useRoomCollections } from "@/lib/yjs/react"

/**
 * Workspace Start (`startWorkspace` in `lib/branch/recovery`) bound to the
 * room's live doc, for surfaces outside the canvas — the prototype player's
 * Retry / Start on a failed or stopped Workspace (issue #731). The canvas runs
 * the same verb through `useBranchActions`.
 */
export function useStartWorkspace(): (branchId: string) => void {
  const collections = useRoomCollections()
  const roomId = useRoomId()
  return useCallback(
    (branchId: string) => {
      startWorkspace(
        branchId,
        {
          roomId,
          findAgent: (id) => collections.branches.toMap().get(id),
          findRepo: (repoId) => collections.repos.toMap().get(repoId),
          patchAgent: (id, patch) =>
            collections.branches.update(id, patch as Partial<BranchData>),
          toast: {
            success: (message) => toast.success(message),
            error: (message, description) =>
              toast.error(message, description ? { description } : undefined),
          },
        },
        { local: isLocalBuild }
      )
    },
    [collections, roomId]
  )
}
