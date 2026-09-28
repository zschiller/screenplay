"use client"

import { DeleteRepoDialog } from "@/components/delete-repo-dialog"
import { useWorkspaceAgentWorking } from "@/components/workspace-mention"
import { useGitHubTokenAvailable } from "@/hooks/use-github-token"
import { useUnsavedWork } from "@/hooks/use-unsaved-work"
import { isLocalBuild } from "@/lib/local-mode"
import { hasGitHubRemote } from "@/lib/repo-identity"
import type { BranchData, RepoData } from "@/lib/types"

/**
 * Remove a Repo from the canvas through {@link DeleteRepoDialog}: gathers the
 * Workspaces it takes with it, reads their unpushed work while open (#776),
 * and offers deleting the git branches on GitHub when a token resolves (#741).
 * Shared by Canvas settings and the sidebar's repository row.
 */
export function RemoveRepositoryDialog({
  repo,
  branches,
  onOpenChange,
  onRemoveRepo,
}: {
  /** The repository to confirm removing; `null` keeps the dialog closed. */
  repo: RepoData | null
  branches: BranchData[]
  onOpenChange: (open: boolean) => void
  onRemoveRepo: (
    id: string,
    options: { deleteBranchesOnRemote: boolean }
  ) => void | Promise<void>
}) {
  const githubTokenAvailable = useGitHubTokenAvailable()
  const agentWorking = useWorkspaceAgentWorking()
  const targets = repo
    ? branches.filter((b) => b.repoId === repo.id && b.ref)
    : []
  const unsavedWork = useUnsavedWork(
    targets,
    repo?.defaultBranch,
    targets.length > 0
  )
  return (
    <DeleteRepoDialog
      open={!!repo}
      onOpenChange={onOpenChange}
      repoName={repo?.name?.trim() || repo?.repoFullName || ""}
      workspaces={targets.map((b) => ({
        id: b.id,
        ref: b.ref,
        title: b.title,
        status: b.status,
        statusMessage: b.statusMessage,
        error: b.error,
        prNumber: b.prNumber,
        prState: b.prState,
        agentWorking: agentWorking(b.id),
        openPrNumber: b.prState === "open" ? b.prNumber : undefined,
        work: unsavedWork.get(b.id),
      }))}
      canDeleteOnRemote={githubTokenAvailable && hasGitHubRemote(repo)}
      localBranchKept={isLocalBuild}
      onConfirm={async ({ deleteBranchesOnRemote }) => {
        if (!repo) return
        await onRemoveRepo(repo.id, { deleteBranchesOnRemote })
        onOpenChange(false)
      }}
    />
  )
}
