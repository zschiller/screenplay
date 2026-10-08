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

import {
  BranchOverflowMenuItems,
  type BranchMenuPart,
} from "@/components/panels/branch-overflow-menu"
import { WorkspaceHoverCard } from "@/components/workspace-hover-card"
import { WorkspaceMention } from "@/components/workspace-mention"
import { usePrReadiness } from "@/hooks/use-pr-readiness"
import { useWorkspaceStates } from "@/hooks/use-workspace-states"
import type { BranchData } from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"

import { useChatsMenu } from "./chats-menu"
import { useViewing } from "@/lib/viewer/context"

/**
 * One Workspace's menu items, the same ones as its Chats row's … (H4): the
 * chat header's … renders them all, and a frame's Preview and Chat submenus
 * each render their half. Wired to the
 * Chats menu's provider, which owns the dialogs they open; renders nothing
 * outside it (play mode's chat).
 */
export function WorkspaceMenuItems({
  branchId,
  onRename,
  onPlay,
  onOpenInBrowser,
  part,
  onOpenLogs,
}: {
  branchId: string
  /** Starts the inline rename. */
  onRename: () => void
  /** Replaces Open in play mode's target (a frame opens on itself). */
  onPlay?: () => void
  /** Replaces Open in browser's target (a frame deep-links its route). */
  onOpenInBrowser?: () => void
  /**
   * One half of the menu, for a frame's Preview or Chat submenu. The Chat
   * half leads with Open chat.
   */
  part?: BranchMenuPart
  /** Open logs, in a frame's Preview submenu. */
  onOpenLogs?: () => void
}) {
  const menu = useChatsMenu()
  const branch = menu?.branches.find((b) => b.id === branchId)
  const repo = branch ? menu?.reposById.get(branch.repoId) : undefined
  const stats = branch ? menu?.diffStats.get(branch.id) : undefined
  const prReadiness = usePrReadiness({
    branch,
    repo,
    pr: branch ? menu?.branchPrs.get(branch.id) : undefined,
    hasChanges: !!stats && (stats.additions > 0 || stats.deletions > 0),
    onCreatePr: (id) => menu?.onCreatePr(id),
  })
  if (!menu || !branch || !repo) return null
  return (
    <BranchOverflowMenuItems
      branch={branch}
      repo={repo}
      onPlay={onPlay ?? menu.onPlayBranch}
      onOpenInBrowser={onOpenInBrowser}
      onRetry={menu.onRetryBranch}
      onRename={onRename}
      onRestartDevServer={menu.onRestartDevServer}
      onRecreate={menu.askRecreate}
      onShowRoutes={menu.onShowRoutes}
      prReadiness={prReadiness}
      onMarkDone={menu.onMarkBranchDone}
      onReopen={menu.onReopenBranch}
      onDelete={menu.askDelete}
      isBusy={menu.stateOf(branch).agentWorking}
      part={part}
      onOpenLogs={onOpenLogs}
      onOpenChat={
        part === "chat" ? () => menu.onSelectWorkspace(branch.id) : undefined
      }
    />
  )
}

/** Whether {@link WorkspaceMenuItems} has anything to render for a Workspace. */
export function useHasWorkspaceMenu(branchId: string | null | undefined) {
  const menu = useChatsMenu()
  return !!branchId && !!menu?.branches.some((b) => b.id === branchId)
}

// The breadcrumb's spacing, not a list row's: a row's 8px gap lines its name
// up under the menu's other 16px icons, but the header's glyph is a 12px mark
// in a 16px slot, so 8px read as a wide 10px hole beside the 6px around the
// crumb's "/". The canvas group label sets it the same way.
const HEADER_MENTION_CLASS = "flex-initial gap-1 text-sm"

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
  const watching = !!useViewing()

  // Rename picked from a frame's Chat submenu opens this chat; the
  // title takes the request once it's showing.
  const renameRequest = menu?.renameRequest
  const clearRenameRequest = menu?.clearRenameRequest
  useEffect(() => {
    if (renameRequest !== branch.id) return
    clearRenameRequest?.()
    editableRef.current?.startEditing()
  }, [renameRequest, clearRenameRequest, branch.id])

  // A viewer (#1933) reads the title; the host renames and acts on it.
  if (!menu || watching) {
    return (
      <WorkspaceHoverCard
        branchId={branch.id}
        side="bottom"
        align="start"
        openChat={false}
      >
        <span className="flex min-w-0">
          <WorkspaceMention
            branch={branch}
            state={state}
            pr={false}
            className={HEADER_MENTION_CLASS}
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
        openChat={false}
      >
        <span className="flex min-w-0 has-[[data-editable-text=editing]]:overflow-visible">
          <WorkspaceMention
            branch={branch}
            state={state}
            pr={false}
            className={HEADER_MENTION_CLASS}
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
