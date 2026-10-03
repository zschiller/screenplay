"use client"

import { useEffect, useRef, useState } from "react"

import { DotsThreeIcon } from "@workspace/ui/components/icons"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  EditableText,
  editableTextFieldClass,
  type EditableTextHandle,
} from "@workspace/ui/components/editable-text"
import { IconButton } from "@workspace/ui/components/icon-button"
import { cn } from "@workspace/ui/lib/utils"

import { BranchOverflowMenuItems } from "@/components/panels/branch-overflow-menu"
import { WorkspaceHoverCard } from "@/components/workspace-hover-card"
import { WorkspaceMention } from "@/components/workspace-mention"
import { useWorkspaceStates } from "@/hooks/use-workspace-states"
import type { BranchData } from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"

import { useChatsMenu } from "./chats-menu"

/**
 * One Workspace's menu items, the same ones as its Chats row's … (H4): the
 * chat header's … and a frame's Workspace submenu render these. Wired to the
 * Chats menu's provider, which owns the dialogs they open; renders nothing
 * outside it (the prototype player's chat).
 */
export function WorkspaceMenuItems({
  branchId,
  onRename,
  onPlay,
  onOpenInBrowser,
}: {
  branchId: string
  /** Starts the inline rename. */
  onRename: () => void
  /** Replaces Open prototype player's target (a frame opens on itself). */
  onPlay?: () => void
  /** Replaces Open in browser's target (a frame deep-links its route). */
  onOpenInBrowser?: () => void
}) {
  const menu = useChatsMenu()
  const branch = menu?.branches.find((b) => b.id === branchId)
  const repo = branch ? menu?.reposById.get(branch.repoId) : undefined
  if (!menu || !branch || !repo) return null
  const stats = menu.diffStats.get(branch.id)
  return (
    <BranchOverflowMenuItems
      branch={branch}
      repo={repo}
      onPlay={onPlay ?? menu.onPlayBranch}
      onOpenInBrowser={onOpenInBrowser}
      onRetry={menu.onRetryBranch}
      hasChanges={!!stats && (stats.additions > 0 || stats.deletions > 0)}
      onRename={onRename}
      onNewBranchFromHere={() =>
        menu.openNewWorkspace(branch.repoId, branch.ref ?? undefined)
      }
      onRestartDevServer={menu.onRestartDevServer}
      onRestart={menu.onRefreshBranch}
      onRecreate={menu.askRecreate}
      onShowRoutes={menu.onShowRoutes}
      onCreatePr={menu.onCreatePr}
      pr={menu.branchPrs.get(branch.id)}
      canCreatePr={menu.canCreatePr(repo)}
      onMarkDone={menu.onMarkBranchDone}
      onReopen={menu.onReopenBranch}
      onDelete={menu.askDelete}
      isBusy={menu.stateOf(branch).agentWorking}
    />
  )
}

/** Whether {@link WorkspaceMenuItems} has anything to render for a Workspace. */
export function useHasWorkspaceMenu(branchId: string | null | undefined) {
  const menu = useChatsMenu()
  return !!branchId && !!menu?.branches.some((b) => b.id === branchId)
}

/**
 * A Workspace chat's title in its header: state icon and name, renamed in
 * place, then a … with the Workspace's menu, like the canvas name's … in the
 * top bar. Outside the Chats menu's provider it's the plain title.
 */
export function WorkspaceHeaderTitle({ branch }: { branch: BranchData }) {
  const menu = useChatsMenu()
  const stateOf = useWorkspaceStates()
  const state = stateOf(branch)
  const editableRef = useRef<EditableTextHandle>(null)
  const pendingEditRef = useRef(false)
  const [renaming, setRenaming] = useState(false)

  // Rename picked from a frame's Workspace submenu opens this chat; the
  // title takes the request once it's showing.
  const renameRequest = menu?.renameRequest
  const clearRenameRequest = menu?.clearRenameRequest
  useEffect(() => {
    if (renameRequest !== branch.id) return
    clearRenameRequest?.()
    editableRef.current?.startEditing()
  }, [renameRequest, clearRenameRequest, branch.id])

  if (!menu) {
    return (
      <WorkspaceHoverCard branchId={branch.id} side="bottom" align="start">
        <span className="flex min-w-0">
          <WorkspaceMention
            branch={branch}
            state={state}
            pr={false}
            className="flex-initial text-sm"
          />
        </span>
      </WorkspaceHoverCard>
    )
  }

  const label = state.label ?? workspaceLabel(branch)
  return (
    <>
      <WorkspaceHoverCard
        branchId={branch.id}
        side="bottom"
        align="start"
        suppressed={renaming || menu.pendingBranchIds.has(branch.id)}
      >
        <span className="flex min-w-0 has-[[data-editable-text=editing]]:overflow-visible">
          <WorkspaceMention
            branch={branch}
            state={state}
            pr={false}
            className="flex-initial text-sm"
            name={
              <EditableText
                ref={editableRef}
                as="span"
                value={label}
                // Renames the title only (#881); the branch moves through
                // Rename branch in the menu.
                disabled={!branch.ref}
                onEditStart={() => setRenaming(true)}
                onEditEnd={() => setRenaming(false)}
                onCommit={(next) => {
                  const title = next.trim()
                  if (!title || title === label) return
                  menu.onUpdateBranch(branch.id, { title })
                }}
                className="min-w-0"
                viewClassName="truncate"
                editClassName={cn(
                  editableTextFieldClass,
                  "-mx-0.5 -my-0.5 min-w-0 px-0.5 py-0.5"
                )}
              />
            }
          />
        </span>
      </WorkspaceHoverCard>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label="Chat options"
            tooltipSide="bottom"
            className={cn(
              "ml-0.5 shrink-0 text-muted-foreground",
              renaming && "invisible"
            )}
          >
            <DotsThreeIcon />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          // Rename is a two-step: the menu closes, then the title takes
          // focus instead of the trigger.
          onCloseAutoFocus={(e) => {
            if (!pendingEditRef.current) return
            pendingEditRef.current = false
            e.preventDefault()
            editableRef.current?.startEditing()
          }}
        >
          <WorkspaceMenuItems
            branchId={branch.id}
            onRename={() => {
              pendingEditRef.current = true
            }}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
