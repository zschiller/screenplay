"use client"

import { Fragment, type ReactNode } from "react"
import {
  ExternalLink,
  GitBranchPlus,
  GitMerge,
  GitPullRequest,
  Palette,
  Pencil,
  Play,
  RefreshCw,
  Recycle,
  RotateCcw,
  RotateCw,
  Route,
  Trash2,
} from "lucide-react"
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import { BRANCH_COLORS } from "@/lib/branch-colors"
import { openExternal } from "@/lib/open-external"
import { openPreviewInBrowser } from "@/lib/open-preview"
import { isLocalBuild } from "@/lib/local-mode"
import { OpenInBrowserItem } from "@/components/open-in-browser-item"
import type { BranchPrInfo } from "@/lib/github-actions"
import type { BranchData, RepoData } from "@/lib/types"

/**
 * Stable key for one branch-menu action. Sections reference these so the
 * rendered order and the structural skeleton stay in lock-step: adding an
 * action means declaring its key in {@link BRANCH_MENU_SECTIONS} and supplying
 * its node, rather than threading it into the middle of a giant JSX block.
 */
export type BranchMenuItemKey =
  | "retry"
  | "rename"
  | "color"
  | "play"
  | "open-in-browser"
  | "routes"
  | "new-branch-from-here"
  | "restart"
  | "create-pr"
  | "rebase"
  | "open-github"
  | "delete"

export type BranchMenuSectionId = "view" | "git" | "manage" | "danger"

export interface BranchMenuSection {
  id: BranchMenuSectionId
  label: string
  /** Item keys owned by this section, in display order. */
  itemKeys: BranchMenuItemKey[]
}

/**
 * The Workspace overflow ("…") menu skeleton (#792): View, Git, Manage, then
 * Delete on its own. The Workspace's state picks one lead action (see
 * {@link workspaceMenuLead}) that renders first, above these sections, and is
 * dropped from the section it would otherwise sit in, so no action (the PR
 * one in particular) shows twice.
 *
 * `fetch`/`pull`/`push`/`sync` are deliberately absent: the always-commit-and-
 * push Engine loop makes them redundant.
 */
export const BRANCH_MENU_SECTIONS: readonly BranchMenuSection[] = [
  {
    id: "view",
    label: "View",
    itemKeys: ["play", "open-in-browser", "routes"],
  },
  {
    id: "git",
    label: "Git",
    itemKeys: ["create-pr", "rebase", "open-github", "new-branch-from-here"],
  },
  { id: "manage", label: "Manage", itemKeys: ["rename", "color", "restart"] },
  { id: "danger", label: "Danger", itemKeys: ["delete"] },
]

/** What the lead action reads. {@link BranchData} satisfies the branch half. */
export interface WorkspaceMenuLeadInput {
  branch: Pick<BranchData, "status" | "error" | "previewDomain">
  pr?: Pick<BranchPrInfo, "state"> | null
  /** The Workspace has a diff against its base (the sidebar's diff stat). */
  hasChanges: boolean
  /** A chat turn is in flight on this Workspace. */
  isBusy: boolean
}

/**
 * The one action that leads the Workspace menu, from its state: Retry when
 * setup failed, the open PR when there is one, Create pull request when there
 * are changes to propose, otherwise the prototype player. A Workspace that's
 * still being set up (or stopped) has no lead: nothing in it works yet.
 */
export function workspaceMenuLead({
  branch,
  pr,
  hasChanges,
  isBusy,
}: WorkspaceMenuLeadInput): BranchMenuItemKey | null {
  if (branch.status === "error" || branch.error) return "retry"
  if (
    branch.status === "creating" ||
    branch.status === "starting" ||
    branch.status === "stopped"
  ) {
    return null
  }
  if (pr?.state === "open") return "create-pr"
  if (hasChanges && !isBusy) return "create-pr"
  return branch.previewDomain ? "play" : null
}

export interface BranchOverflowMenuContentProps {
  branch: BranchData
  repo: RepoData
  onPlay: (branchId: string) => void
  /** Re-runs a failed setup (the status icon's Retry). Leads the menu on error. */
  onRetry: (branchId: string) => void
  /** The Workspace has a diff against its base; see {@link workspaceMenuLead}. */
  hasChanges?: boolean
  /** Opens the inline branch-name editor — already bound to this branch. */
  onRename: () => void
  onUpdateBranch: (id: string, data: Partial<BranchData>) => void
  /**
   * Opens the create dialog seeded with this branch as the base and an empty
   * prompt (#353) — no longer an immediate fork with a random name.
   */
  onNewBranchFromHere: (branchId: string) => void
  /** Bounce the dev server in place — no VM cycle. Stays enabled while working. */
  onRestartDevServer: (branchId: string) => void
  /**
   * Snapshot-restore the sandbox onto a fresh VM, preserving the working tree.
   * Hosted-only — the local backend has no VM to cycle, so the item is hidden
   * there (see {@link isLocalBuild} gate in the restart submenu).
   */
  onRestart: (branchId: string) => void
  /**
   * Destructive reclone from git — discards the working tree. The handler opens
   * the AlertDialog confirm; the actual recreate runs only on confirm.
   */
  onRecreate: (branchId: string) => void
  onShowRoutes: (branchId: string) => void
  /**
   * Opens a GitHub PR for this branch via the direct server action (#355) —
   * deterministic title/body, no model turn. Disabled while the branch is busy.
   */
  onCreatePr: (branchId: string) => void
  /**
   * This branch's known PR from the shared source of truth, or null. When a PR
   * is open the "Create pull request" item becomes "Open pull request" linking
   * straight to it, so the menu never offers to re-create a PR that exists.
   */
  pr?: BranchPrInfo | null
  onRebase: (branchId: string) => void
  onDelete: (branchId: string) => void
  onCloseAutoFocus?: (event: Event) => void
  /**
   * Whether this Branch's agent is currently working (`isBranchBusy`). Gates
   * the "disable while working" items — Rebase on `main` today. Routing is
   * unchanged; an enabled click while busy would be a silent no-op because the
   * chat store ignores messages mid-stream.
   */
  isBusy?: boolean
}

/**
 * Renders the Workspace overflow menu's `<DropdownMenuContent>`: the lead
 * action from {@link workspaceMenuLead}, then {@link BRANCH_MENU_SECTIONS} with
 * separators between groups (no section labels).
 */
export function BranchOverflowMenuContent({
  branch,
  repo,
  onPlay,
  onRetry,
  hasChanges = false,
  onRename,
  onUpdateBranch,
  onNewBranchFromHere,
  onRestartDevServer,
  onRestart,
  onRecreate,
  onShowRoutes,
  onCreatePr,
  onRebase,
  onDelete,
  onCloseAutoFocus,
  pr,
  isBusy = false,
}: BranchOverflowMenuContentProps) {
  const nodes: Record<BranchMenuItemKey, ReactNode> = {
    retry: (
      <DropdownMenuItem onClick={() => onRetry(branch.id)}>
        <RotateCw />
        Retry setup
      </DropdownMenuItem>
    ),
    rename: (
      <DropdownMenuItem disabled={!branch.ref} onClick={onRename}>
        <Pencil />
        Rename
      </DropdownMenuItem>
    ),
    color: (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Palette />
          Color
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-40">
          <DropdownMenuRadioGroup
            value={
              branch.colorIndex !== undefined ? String(branch.colorIndex) : ""
            }
            onValueChange={(v) =>
              onUpdateBranch(branch.id, { colorIndex: Number(v) })
            }
          >
            {BRANCH_COLORS.map((c, i) => (
              <DropdownMenuRadioItem key={c.name} value={String(i)}>
                <span className={cn("size-4 rounded-[3px]", c.swatch)} />
                <span className="capitalize">{c.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={branch.colorIndex === undefined}
            onClick={() => onUpdateBranch(branch.id, { colorIndex: undefined })}
          >
            Reset to default
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ),
    play: (
      <DropdownMenuItem
        disabled={!branch.previewDomain}
        onClick={() => onPlay(branch.id)}
      >
        <Play />
        Open prototype player
      </DropdownMenuItem>
    ),
    // Pop the branch's live preview into a real browser tab, outside the
    // prototype-player wrapper. Opens the preview root (the frame toolbar's
    // copy of this same item deep-links the route it's showing instead).
    "open-in-browser": (
      <OpenInBrowserItem
        disabled={!branch.previewDomain}
        onOpen={() =>
          openPreviewInBrowser({
            sandboxName: branch.sandboxName,
            repo,
            fallbackBase: branch.previewDomain,
          })
        }
      />
    ),
    routes: (
      <DropdownMenuItem
        disabled={
          !branch.discoveredRoutes || branch.discoveredRoutes.length === 0
        }
        onClick={() => onShowRoutes(branch.id)}
      >
        <Route />
        Show all routes
      </DropdownMenuItem>
    ),
    "new-branch-from-here": (
      <DropdownMenuItem
        disabled={!branch.ref}
        onClick={() => onNewBranchFromHere(branch.id)}
      >
        <GitBranchPlus />
        New workspace from here…
      </DropdownMenuItem>
    ),
    restart: (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <RefreshCw />
          Restart
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-48">
          {/*
            Restart dev server bounces the dev process inside the existing
            Sandbox — no VM cycle, working tree untouched — so it stays enabled
            even while the agent is working, the one restart that can fix a
            wedged preview mid-turn.
          */}
          <DropdownMenuItem
            disabled={!branch.sandboxName}
            onClick={() => onRestartDevServer(branch.id)}
          >
            <RefreshCw />
            Restart dev server
          </DropdownMenuItem>
          {/*
            Restart sandbox snapshot-restores onto a fresh VM, preserving the
            working tree. It cycles the VM, so — like Recreate — it's disabled
            while the agent is working.

            Hosted-only: the local backend runs worktrees on the host, not VMs,
            so there's nothing to snapshot-restore — its two honest restart tiers
            are "Restart dev server" (bounce the process, keep the working tree)
            and "Recreate from scratch" (reclone from git, discard it). A VM
            cycle would only ever fail loud there, so the local build omits it.
          */}
          {!isLocalBuild ? (
            <DropdownMenuItem
              disabled={!branch.sandboxName || isBusy}
              onClick={() => onRestart(branch.id)}
            >
              <RotateCcw />
              Restart sandbox
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuSeparator />
          {/*
            Recreate from scratch is the destructive reclone from git — it
            discards uncommitted work — so it's fenced off behind a separator and
            gated behind an AlertDialog confirm (opened by the handler).
          */}
          <DropdownMenuItem
            variant="destructive"
            disabled={!branch.sandboxName || isBusy}
            onClick={() => onRecreate(branch.id)}
          >
            <Recycle />
            Recreate from scratch
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ),
    // An open PR makes "Create" a duplicate-creating no-op, so swap it for a
    // direct link to the PR. Closed/merged PRs fall through to "Create" since
    // the branch can legitimately open a fresh one.
    "create-pr":
      pr?.state === "open" ? (
        <DropdownMenuItem onClick={() => openExternal(pr.url)}>
          <GitPullRequest />
          Open pull request #{pr.number}
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem
          disabled={!branch.sandboxName || !branch.ref || isBusy}
          onClick={() => onCreatePr(branch.id)}
        >
          <GitPullRequest />
          Create pull request
        </DropdownMenuItem>
      ),
    rebase: (
      <DropdownMenuItem
        disabled={!branch.sandboxName || !branch.ref || isBusy}
        onClick={() => onRebase(branch.id)}
      >
        <GitMerge />
        Rebase on {repo.defaultBranch}
      </DropdownMenuItem>
    ),
    "open-github": (
      <DropdownMenuItem
        disabled={!branch.ref}
        onClick={() => {
          if (!branch.ref) return
          const url = `https://github.com/${repo.repoOwner}/${repo.repoName}/tree/${encodeURI(branch.ref)}`
          openExternal(url)
        }}
      >
        <ExternalLink />
        Open branch on GitHub
      </DropdownMenuItem>
    ),
    delete: (
      <DropdownMenuItem
        variant="destructive"
        onClick={() => onDelete(branch.id)}
      >
        <Trash2 />
        Delete
      </DropdownMenuItem>
    ),
  }

  const lead = workspaceMenuLead({ branch, pr, hasChanges, isBusy })
  const groups = [
    ...(lead ? [{ id: "lead", itemKeys: [lead] }] : []),
    ...BRANCH_MENU_SECTIONS.map((section) => ({
      id: section.id,
      itemKeys: section.itemKeys.filter((key) => key !== lead),
    })),
  ].filter((group) => group.itemKeys.length > 0)

  return (
    <DropdownMenuContent
      side="right"
      align="start"
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {groups.map((group, i) => (
        <Fragment key={group.id}>
          {i > 0 ? <DropdownMenuSeparator /> : null}
          {group.itemKeys.map((key) => (
            <Fragment key={key}>{nodes[key]}</Fragment>
          ))}
        </Fragment>
      ))}
    </DropdownMenuContent>
  )
}
