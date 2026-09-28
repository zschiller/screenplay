import { cn } from "@workspace/ui/lib/utils"

/**
 * Class list for a Workspace row in the in-room sidebar. The row whose chat
 * panel is open shows the selected background. A Workspace that is still
 * creating/starting isn't dimmed: its status line says so in words (#791).
 */
export function branchRowClassName({
  isPanelActive,
}: {
  isPanelActive: boolean
}): string {
  return cn(
    "group/branch-row grid grid-cols-[1fr_auto] items-center rounded-md hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
    isPanelActive && "bg-sidebar-accent text-sidebar-accent-foreground"
  )
}
