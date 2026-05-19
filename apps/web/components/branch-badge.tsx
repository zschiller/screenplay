import { GitBranch } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { EditableText } from "@workspace/ui/components/editable-text"
import { getBranchColor } from "@/lib/branch-colors"
import { cn } from "@workspace/ui/lib/utils"

interface BranchBadgeProps {
  branch: string
  /** String used to pick the badge color (defaults to branch name) */
  colorKey?: string
  /** Manual override into the palette — wins over `colorKey` when valid. */
  colorIndex?: number
  /** Show the git-branch icon before the name */
  icon?: boolean
  className?: string
  /** When provided, double-clicking the badge enters inline-rename mode.
   *  The callback should validate and either apply the rename or silently
   *  drop it — the badge re-renders from its `branch` prop either way. */
  onRename?: (next: string) => void
}

export function BranchBadge({ branch, colorKey, colorIndex, icon = false, className, onRename }: BranchBadgeProps) {
  const color = getBranchColor(colorKey ?? branch, colorIndex)

  return (
    <Badge
      variant="outline"
      className={cn(
        "max-w-full gap-1 border-transparent font-mono",
        // Allow the inline-rename input's bg/inset-ring to render without being
        // clipped by ancestor truncate (which would set overflow:hidden on us).
        // Internal scroll is handled by the EditableText itself in edit mode.
        onRename && "!overflow-visible",
        color.badge,
        className,
      )}
    >
      {icon && <GitBranch className="h-3 w-3 shrink-0" />}
      {onRename ? (
        <EditableText
          as="span"
          value={branch}
          onCommit={onRename}
          className="min-w-0"
          viewClassName="truncate"
          editClassName="relative z-10 flex-1 min-w-0 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xs bg-white text-black shadow-sm ring-[0.5px] ring-black/15 px-0.5 py-0.5 -mx-0.5 -my-0.5"
        />
      ) : (
        <span className="truncate">{branch}</span>
      )}
    </Badge>
  )
}
