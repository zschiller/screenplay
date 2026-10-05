import {
  GitMergeConflictIcon,
  GitMergeIcon,
  GitPullRequestClosedIcon,
  GitPullRequestIcon,
  type IconProps,
} from "@workspace/ui/components/icons"

import { shownPrState } from "@/components/pr-state-color"
import type { BranchPrInfo } from "@/lib/github-actions"

/**
 * GitHub's PR state glyph, one shape per state: open, merged, closed, and
 * merge blocked. Shared by the chat header's PR button and the Workspace PR
 * badge so the two always agree.
 */
export function PrStateIcon({
  state,
  blocked,
  ...props
}: IconProps & { state: BranchPrInfo["state"]; blocked?: boolean }) {
  switch (shownPrState(state, blocked)) {
    case "merged":
      return <GitMergeIcon {...props} />
    case "closed":
      return <GitPullRequestClosedIcon {...props} />
    case "blocked":
      return <GitMergeConflictIcon {...props} />
    default:
      return <GitPullRequestIcon {...props} />
  }
}
