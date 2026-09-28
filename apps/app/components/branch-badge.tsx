import { forwardRef } from "react"
import { GitBranch } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import {
  EditableText,
  type EditableTextHandle,
} from "@workspace/ui/components/editable-text"
import { getBranchColor } from "@/lib/branch-colors"
import { hasWorkspaceTitle, workspaceLabel } from "@/lib/workspace-label"
import { cn } from "@workspace/ui/lib/utils"

interface BranchBadgeProps {
  /** The Workspace's git branch. Shown in mono when it has no `title`. */
  branch: string
  /** The Workspace's title (#881). When set it's shown in the regular face
   *  instead of the branch — see `workspaceLabel`. */
  title?: string
  /** String used to pick the badge color (defaults to branch name) */
  colorKey?: string
  /** Manual override into the palette — wins over `colorKey` when valid. */
  colorIndex?: number
  /** Show the git-branch icon before the name */
  icon?: boolean
  className?: string
  /** When provided, double-clicking the badge enters inline-rename mode on
   *  the label it shows. The callback should validate and either apply the
   *  rename or silently drop it — the badge re-renders from its props either
   *  way. */
  onRename?: (next: string) => void
}

export const BranchBadge = forwardRef<EditableTextHandle, BranchBadgeProps>(
  function BranchBadge(
    { branch, title, colorKey, colorIndex, icon = false, className, onRename },
    ref
  ) {
    const color = getBranchColor(colorKey ?? branch, colorIndex)
    const label = workspaceLabel({ title, ref: branch })

    return (
      <Badge
        variant="outline"
        className={cn(
          "max-w-full gap-1 border-transparent",
          !hasWorkspaceTitle({ title }) && "font-mono",
          // Allow the inline-rename input's bg/inset-ring to render without being
          // clipped by ancestor truncate (which would set overflow:hidden on us).
          // Internal scroll is handled by the EditableText itself in edit mode.
          onRename && "has-[[data-editable-text=editing]]:!overflow-visible",
          color.badge,
          className
        )}
        // A title has spaces: keep the editor's keys from bubbling to an
        // ancestor sortable row, whose keyboard sensor eats Space (#881).
        onKeyDown={
          onRename
            ? (e) => {
                if ((e.target as HTMLElement).isContentEditable)
                  e.stopPropagation()
              }
            : undefined
        }
      >
        {icon && <GitBranch className="size-3 shrink-0" />}
        {onRename ? (
          <EditableText
            ref={ref}
            as="span"
            value={label}
            onCommit={onRename}
            lockWidthOnEdit
            className="min-w-0"
            viewClassName="truncate"
            editClassName="relative z-10 box-content min-w-0 max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden rounded-xs bg-white text-black shadow-sm ring-[0.5px] ring-black/15 px-0.5 py-0.5 -mx-0.5 -my-0.5"
          />
        ) : (
          <span className="truncate">{label}</span>
        )}
      </Badge>
    )
  }
)
