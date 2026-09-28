import { GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react"
import { cn } from "@workspace/ui/lib/utils"
import { prStateColor } from "@/components/pr-state-color"
import type { BranchPrInfo } from "@/lib/github-actions"

/**
 * A Workspace's PR at the end of its row (#963): GitHub's state glyph and
 * `#N` in its state colour, in the slot the line count takes when there's no
 * PR. Shared by the sidebar rows and the frame's Workspace switcher list so
 * the two agree.
 */
export function PrStateBadge({
  number,
  state,
  className,
}: {
  number: number
  state: BranchPrInfo["state"]
  className?: string
}) {
  const Icon =
    state === "merged"
      ? GitMerge
      : state === "closed"
        ? GitPullRequestClosed
        : GitPullRequest
  return (
    <span
      className={cn(
        "flex items-center gap-0.5 font-mono text-3xs font-medium",
        prStateColor(state),
        className
      )}
    >
      <Icon aria-hidden className="size-3 text-current" />
      <span className="sr-only">PR </span>#{number}
      <span className="sr-only">, {state}</span>
    </span>
  )
}
