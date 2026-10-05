"use client"

import { Fragment, type ReactNode } from "react"
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowUUpLeftIcon,
  ArrowUpRightIcon,
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  PathIcon,
  PencilSimpleIcon,
  PlayIcon,
  RecycleIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { branchPrList, type PrListItem } from "@/lib/branch/pr-history"
import type { PrReadinessState } from "@/lib/branch/pr-readiness"
import { cn } from "@workspace/ui/lib/utils"
import { openExternal } from "@/lib/open-external"
import { openPreviewInBrowser } from "@/lib/open-preview"
import { isLocalBuild } from "@/lib/local-mode"
import { OpenInBrowserItem } from "@/components/open-in-browser-item"
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
  | "play"
  | "open-in-browser"
  | "routes"
  | "restart"
  | "create-pr"
  | "pull-requests"
  | "mark-done"
  | "reopen"
  | "delete"

export type BranchMenuSectionId =
  "view" | "git" | "pull-requests" | "manage" | "danger"

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
 * push Engine loop makes them redundant. So are rebasing, renaming the branch
 * and opening it on GitHub: a chat's branch is named for it and stays out of
 * sight, and its pull request is the GitHub page worth opening.
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
    itemKeys: ["create-pr"],
  },
  {
    id: "pull-requests",
    label: "Pull requests",
    itemKeys: ["pull-requests"],
  },
  {
    id: "manage",
    label: "Manage",
    itemKeys: ["rename", "restart", "mark-done"],
  },
  { id: "danger", label: "Danger", itemKeys: ["delete"] },
]

/**
 * What a Done Workspace's menu leaves out (#976): everything that needs its
 * sandbox running. Reopen leads instead, and its PR keeps its link (Create PR
 * Readiness hides the create).
 */
const HIDDEN_WHILE_DONE: ReadonlySet<BranchMenuItemKey> = new Set([
  "play",
  "open-in-browser",
  "routes",
  "restart",
  "mark-done",
])

/** What the lead action reads. {@link BranchData} satisfies the branch half. */
export interface WorkspaceMenuLeadInput {
  branch: Pick<BranchData, "status" | "error" | "previewDomain" | "doneAt">
  /** A chat turn is in flight on this Workspace. */
  isBusy: boolean
  /** Its Create PR Readiness. */
  prReadiness: PrReadinessState
}

/**
 * The one action that leads the Workspace menu, from its state: Retry when
 * setup failed, Mark as done once its PR has merged and the agent is idle,
 * Create pull request when nothing blocks it (it keeps the lead while it
 * runs), otherwise the prototype player. Its PRs have their own group. A
 * Workspace that's still being set up (or stopped, until its PR merges) has no
 * lead: nothing in it works yet. A Done one leads with Reopen (#976).
 */
export function workspaceMenuLead({
  branch,
  isBusy,
  prReadiness,
}: WorkspaceMenuLeadInput): BranchMenuItemKey | null {
  const pr = prReadiness.existingPr
  if (branch.doneAt) return "reopen"
  if (branch.status === "error" || branch.error) return "retry"
  if (branch.status === "creating" || branch.status === "starting") return null
  if (pr?.state === "merged" && !isBusy) return "mark-done"
  if (branch.status === "stopped") return null
  if (prReadiness.shown && !prReadiness.blocker) return "create-pr"
  return branch.previewDomain ? "play" : null
}

export interface BranchOverflowMenuContentProps {
  branch: BranchData
  repo: RepoData
  onPlay: (branchId: string) => void
  /** Re-runs a failed setup (the status icon's Retry). Leads the menu on error. */
  onRetry: (branchId: string) => void
  /** Opens the inline title editor — already bound to this Workspace. */
  onRename: () => void
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
   * Create PR Readiness (`usePrReadiness`), the same the chat header's Create
   * PR renders from. Create pull request shows when `shown`, disabled with
   * the blocker's reason as its tooltip, and `run` opens the PR (#355). Every
   * PR the Workspace opened is listed in the Pull requests group (#1701).
   */
  prReadiness: PrReadinessState & { run: () => void }
  /** Marks the Workspace Done (#976): stops its sandbox and hides its frames. */
  onMarkDone: (branchId: string) => void
  /** Undoes Mark as done: starts the Workspace and shows its frames again. */
  onReopen: (branchId: string) => void
  onDelete: (branchId: string) => void
  onCloseAutoFocus?: (event: Event) => void
  /**
   * Replaces Open in browser's target, the preview root. A frame's copy of
   * the menu passes one that deep-links the route the frame shows.
   */
  onOpenInBrowser?: () => void
  /**
   * Whether this Branch's agent is currently working (Workspace State's
   * `agentWorking`). Gates the "disable while working" items, like Restart
   * sandbox and Mark as done; Create pull request reads it through
   * `prReadiness`.
   */
  isBusy?: boolean
}

/**
 * Renders the Workspace overflow menu's `<DropdownMenuContent>`: the lead
 * action from {@link workspaceMenuLead}, then {@link BRANCH_MENU_SECTIONS} with
 * separators between groups (no section labels).
 */
export function BranchOverflowMenuContent({
  onCloseAutoFocus,
  ...props
}: BranchOverflowMenuContentProps) {
  return (
    <DropdownMenuContent
      side="bottom"
      align="end"
      onCloseAutoFocus={onCloseAutoFocus}
    >
      <BranchOverflowMenuItems {...props} />
    </DropdownMenuContent>
  )
}

/**
 * The Workspace menu's items without their content box, for a menu that
 * places them itself: the chat header's … and a frame's Workspace submenu.
 */
export function BranchOverflowMenuItems({
  branch,
  repo,
  onPlay,
  onRetry,
  onRename,
  onRestartDevServer,
  onRestart,
  onRecreate,
  onShowRoutes,
  onMarkDone,
  onReopen,
  onDelete,
  onOpenInBrowser,
  prReadiness,
  isBusy = false,
}: Omit<BranchOverflowMenuContentProps, "onCloseAutoFocus">) {
  const prs = branchPrList(branch, prReadiness.existingPr)
  const nodes: Record<BranchMenuItemKey, ReactNode> = {
    retry: (
      <DropdownMenuItem onClick={() => onRetry(branch.id)}>
        <ArrowClockwiseIcon />
        Retry setup
      </DropdownMenuItem>
    ),
    rename: (
      <DropdownMenuItem disabled={!branch.ref} onClick={onRename}>
        <PencilSimpleIcon />
        Rename
      </DropdownMenuItem>
    ),
    play: (
      <DropdownMenuItem
        disabled={!branch.previewDomain}
        onClick={() => onPlay(branch.id)}
      >
        <PlayIcon />
        Open prototype player
      </DropdownMenuItem>
    ),
    // Pop the branch's live preview into a real browser tab, outside the
    // prototype-player wrapper. Opens the preview root (the frame toolbar's
    // copy of this same item deep-links the route it's showing instead).
    "open-in-browser": (
      <OpenInBrowserItem
        disabled={!branch.previewDomain}
        onOpen={
          onOpenInBrowser ??
          (() =>
            openPreviewInBrowser({
              sandboxName: branch.sandboxName,
              repo,
              fallbackBase: branch.previewDomain,
            }))
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
        <PathIcon />
        Show all routes
      </DropdownMenuItem>
    ),
    restart: (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <ArrowsClockwiseIcon />
          Restart
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
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
            <ArrowsClockwiseIcon />
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
              <ArrowCounterClockwiseIcon />
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
            <RecycleIcon />
            Recreate from scratch
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    ),
    // A blocked create says why in a tooltip, like the chat header's Create
    // PR. A Workspace with a PR to link shows none (Create PR Readiness).
    "create-pr": prReadiness.blocker ? (
      // A disabled item takes no pointer events, so the reason hangs off a
      // wrapper.
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div>
              <DropdownMenuItem disabled>
                <GitPullRequestIcon />
                Create pull request
              </DropdownMenuItem>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">
            {prReadiness.blocker.reason}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : (
      <DropdownMenuItem
        disabled={prReadiness.running}
        onClick={prReadiness.run}
      >
        {prReadiness.running ? <Spinner /> : <GitPullRequestIcon />}
        {prReadiness.running ? "Creating pull request…" : "Create pull request"}
      </DropdownMenuItem>
    ),
    // Every PR the Workspace opened, newest first, each opening on GitHub
    // (#1701). State shows by colour alone.
    "pull-requests": (
      <>
        <DropdownMenuLabel>Pull requests</DropdownMenuLabel>
        {prs.map((item) => (
          <PullRequestItem key={item.number} pr={item} />
        ))}
      </>
    ),
    // Not while the agent works (its turn needs the sandbox) or while setup
    // is still running.
    "mark-done": (
      <DropdownMenuItem
        disabled={
          isBusy || branch.status === "creating" || branch.status === "starting"
        }
        onClick={() => onMarkDone(branch.id)}
      >
        <CheckCircleIcon />
        Mark as done
      </DropdownMenuItem>
    ),
    reopen: (
      <DropdownMenuItem onClick={() => onReopen(branch.id)}>
        <ArrowUUpLeftIcon />
        Reopen
      </DropdownMenuItem>
    ),
    delete: (
      <DropdownMenuItem
        variant="destructive"
        onClick={() => onDelete(branch.id)}
      >
        <TrashIcon />
        Delete
      </DropdownMenuItem>
    ),
  }

  const lead = workspaceMenuLead({ branch, isBusy, prReadiness })
  const shown = (key: BranchMenuItemKey) => {
    if (key === lead) return false
    if (key === "create-pr") return prReadiness.shown
    if (key === "pull-requests") return prs.length > 0
    if (!branch.doneAt) return true
    return !HIDDEN_WHILE_DONE.has(key)
  }
  const groups = [
    ...(lead ? [{ id: "lead", itemKeys: [lead] }] : []),
    ...BRANCH_MENU_SECTIONS.map((section) => ({
      id: section.id,
      itemKeys: section.itemKeys.filter(shown),
    })),
  ].filter((group) => group.itemKeys.length > 0)

  return groups.map((group, i) => (
    <Fragment key={group.id}>
      {i > 0 ? <DropdownMenuSeparator /> : null}
      {group.itemKeys.map((key) => (
        <Fragment key={key}>{nodes[key]}</Fragment>
      ))}
    </Fragment>
  ))
}

/**
 * `prStateColor` for a menu row: a highlighted item sets every
 * descendant to the accent foreground, so the state colour is marked
 * important to keep it on hover.
 */
const PR_ROW_COLOR: Record<PrListItem["state"], string> = {
  open: "text-success!",
  merged: "text-merged!",
  closed: "text-destructive!",
}

/**
 * One row of the Pull requests group: GitHub's state glyph and `#N` in the
 * state colour, the title, and the external-link arrow the chat header's PR
 * button has, muted until the row is highlighted.
 */
function PullRequestItem({ pr }: { pr: PrListItem }) {
  const Icon = pr.state === "merged" ? GitMergeIcon : GitPullRequestIcon
  const color = PR_ROW_COLOR[pr.state]
  return (
    <DropdownMenuItem onClick={() => openExternal(pr.url)}>
      <span className={cn("flex items-center gap-1 tabular-nums", color)}>
        <Icon aria-hidden className={color} />
        <span className="sr-only">Pull request </span>#{pr.number}
        <span className="sr-only">, {pr.state}</span>
      </span>
      {pr.title ? (
        <span className="max-w-72 truncate" title={pr.title}>
          {pr.title}
        </span>
      ) : null}
      <ArrowUpRightIcon aria-hidden className="ml-auto text-muted-foreground" />
    </DropdownMenuItem>
  )
}
