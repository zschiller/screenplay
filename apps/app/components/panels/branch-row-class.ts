import { cn } from "@workspace/ui/lib/utils"

/**
 * Class list for a Workspace row in the in-room sidebar. The row whose chat
 * panel is open shows the selected background; a Workspace that is still
 * creating/starting is dimmed.
 */
export function branchRowClassName({
  isPanelActive,
  isLoading,
}: {
  isPanelActive: boolean
  isLoading: boolean
}): string {
  return cn(
    "group/branch-row grid grid-cols-[1fr_auto] items-center rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    isPanelActive && "bg-sidebar-accent text-sidebar-accent-foreground",
    isLoading && "opacity-50"
  )
}
