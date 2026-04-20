import { GitBranch } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { getBranchColor } from "@/lib/branch-colors"
import { cn } from "@workspace/ui/lib/utils"

interface BranchBadgeProps {
  branch: string
  /** String used to pick the badge color (defaults to branch name) */
  colorKey?: string
  /** Show the git-branch icon before the name */
  icon?: boolean
  className?: string
}

export function BranchBadge({ branch, colorKey, icon = false, className }: BranchBadgeProps) {
  const color = getBranchColor(colorKey ?? branch)

  return (
    <Badge
      variant="outline"
      className={cn(
        "max-w-full gap-1 border-transparent font-mono",
        color.badge,
        className,
      )}
    >
      {icon && <GitBranch className="h-3 w-3 shrink-0" />}
      <span className="truncate">{branch}</span>
    </Badge>
  )
}
