"use client"

import { Fragment, type ReactNode } from "react"
import {
  ArrowClockwiseIcon,
  ArrowUUpLeftIcon,
  ArrowUpRightIcon,
  ArrowsClockwiseIcon,
  ChatCircleIcon,
  CheckCircleIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  PathIcon,
  PencilSimpleIcon,
  PlayIcon,
  RecycleIcon,
  TerminalWindowIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
import { OpenInBrowserItem } from "@/components/open-in-browser-item"
import type { BranchData, RepoData } from "@/lib/types"

/**
 * Stable key for one branch-menu action. Sections reference these so the
 * rendered order and the structural skeleton stay in lock-step: adding an
 * action means declaring its key in {@link BRANCH_MENU_SECTIONS} and supplying
 * its node, rather than threading it into the middle of a giant JSX block.
 */
export type BranchMenuItemKey =
  | "open-chat"
  | "retry"
  | "rename"
  | "play"
  | "open-in-browser"
  | "routes"
  | "logs"
  | "restart-preview"
  | "set-up-again"
  | "create-pr"
  | "pull-requests"
  | "mark-done"
  | "reopen"
  | "delete"

export type BranchMenuSectionId =
  "open" | "view" | "recover" | "git" | "pull-requests" | "manage" | "danger"

export interface BranchMenuSection {
  id: BranchMenuSectionId
  label: string
  /** Item keys owned by this section, in display order. */
  itemKeys: BranchMenuItemKey[]
}

/**
 * The Workspace overflow ("…") menu skeleton (#792): View, Recover, Git,
 * Manage, then Delete on its own (Open, a frame's Open chat, comes first).
 * The Workspace's state picks one lead action (see {@link workspaceMenuLead})
 * that renders first, above these sections, and is dropped from the section
 * it would otherwise sit in, so no action (the PR one in particular) shows
 * twice.
 *
 * `fetch`/`pull`/`push`/`sync` are deliberately absent: the always-commit-and-
 * push Engine loop makes them redundant. So are rebasing, renaming the branch
 * and opening it on GitHub: a chat's branch is named for it and stays out of
 * sight, and its pull request is the GitHub page worth opening.
 */
export const BRANCH_MENU_SECTIONS: readonly BranchMenuSection[] = [
  { id: "open", label: "Open", itemKeys: ["open-chat"] },
  {
    id: "view",
    label: "View",
    itemKeys: ["play", "open-in-browser", "routes", "logs"],
  },
  {
    id: "recover",
    label: "Recover",
    itemKeys: ["restart-preview", "set-up-again"],
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
    itemKeys: ["rename", "mark-done"],
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
  "logs",
  "restart-preview",
  "set-up-again",
  "mark-done",
])

/**
 * A frame's menu splits this one in two (its Preview and Chat submenus): what
 * acts on the running app the frame shows, and what acts on the chat. Every
 * key not listed here is the chat's.
 */
const PREVIEW_ITEMS: ReadonlySet<BranchMenuItemKey> = new Set([
  "retry",
  "play",
  "open-in-browser",
  "routes",
  "logs",
  "restart-preview",
  "set-up-again",
])

/** Which half of the menu a frame's submenu shows (see {@link PREVIEW_ITEMS}). */
export type BranchMenuPart = "preview" | "chat"

/** What the lead action reads. {@link BranchData} satisfies the branch half. */
export interface WorkspaceMenuLeadInput {
  branch: Pick<BranchData, "status" | "error" | "previewDomain" | "doneAt">
  /** A chat turn is in flight on this Workspace. */
  isBusy: boolean
  /** Its Create PR Readiness. */
  prReadiness: PrReadinessState
}

/**
 * The one action that leads the Workspace menu, from its state: Retry (Set
 * up again) when setup failed, Mark as done once its PR has merged and the agent is idle,
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
  /**
   * Re-runs a failed setup (the status icon's Retry). Leads the menu on error
   * as Set up again, standing in for the recreate: there's nothing to lose.
   */
  onRetry: (branchId: string) => void
  /** Opens the inline title editor — already bound to this Workspace. */
  onRename: () => void
  /**
   * Restart preview: bounce the dev server in place, no VM cycle. Stays
   * enabled while working.
   */
  onRestartDevServer: (branchId: string) => void
  /**
   * Set up again…: the destructive reclone from git, discarding the working
   * tree. The handler opens the confirm; the recreate runs only on confirm.
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
   * `agentWorking`). Gates the "disable while working" items, like Set up
   * again and Mark as done; Create pull request reads it through
   * `prReadiness`.
   */
  isBusy?: boolean
  /**
   * Only one half of the menu, for a frame's Preview or Chat submenu. Those
   * say what an item acts on where the frame's own items sit beside them:
   * Delete chat, and Add frames for all routes.
   */
  part?: BranchMenuPart
  /** Open logs: the chat's Preview terminal. A frame's Preview submenu. */
  onOpenLogs?: () => void
  /** Open chat, leading a frame's Chat submenu. */
  onOpenChat?: () => void
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
  onRecreate,
  onShowRoutes,
  onMarkDone,
  onReopen,
  onDelete,
  onOpenInBrowser,
  prReadiness,
  isBusy = false,
  part,
  onOpenLogs,
  onOpenChat,
}: Omit<BranchOverflowMenuContentProps, "onCloseAutoFocus">) {
  const prs = branchPrList(branch, prReadiness.existingPr)
  const nodes: Record<BranchMenuItemKey, ReactNode> = {
    "open-chat": (
      <DropdownMenuItem onClick={onOpenChat}>
        <ChatCircleIcon />
        Open chat
      </DropdownMenuItem>
    ),
    retry: (
      <DropdownMenuItem onClick={() => onRetry(branch.id)}>
        <ArrowClockwiseIcon />
        Set up again
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
        Open in prototype player
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
        {part ? "Add frames for all routes" : "Show all routes"}
      </DropdownMenuItem>
    ),
    logs: (
      <DropdownMenuItem onClick={onOpenLogs}>
        <TerminalWindowIcon />
        Open logs
      </DropdownMenuItem>
    ),
    // Restart preview bounces the dev process inside the existing Sandbox:
    // no VM cycle, working tree untouched, so it stays enabled while the
    // agent works, the one recovery that can fix a wedged preview mid-turn.
    "restart-preview": (
      <DropdownMenuItem
        disabled={!branch.sandboxName}
        onClick={() => onRestartDevServer(branch.id)}
      >
        <ArrowsClockwiseIcon />
        Restart preview
      </DropdownMenuItem>
    ),
    // Set up again… is the destructive reclone from git: it discards
    // unpushed work, so it's red and confirms first (the handler opens it).
    // The VM-cycling Restart sandbox is gone from the menu: the agent pushes
    // every turn, so it rarely kept anything this doesn't.
    "set-up-again": (
      <DropdownMenuItem
        variant="destructive"
        disabled={!branch.sandboxName || isBusy}
        onClick={() => onRecreate(branch.id)}
      >
        <RecycleIcon />
        Set up again…
      </DropdownMenuItem>
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
        {part === "chat" ? "Delete chat" : "Delete"}
      </DropdownMenuItem>
    ),
  }

  const inPart = (key: BranchMenuItemKey) =>
    !part || (part === "preview") === PREVIEW_ITEMS.has(key)
  const naturalLead = workspaceMenuLead({ branch, isBusy, prReadiness })
  // A frame's Preview submenu leads only with Set up again on a failed setup;
  // the player stays in its place among the view items.
  const lead =
    naturalLead &&
    inPart(naturalLead) &&
    (part !== "preview" || naturalLead === "retry") &&
    !(part && naturalLead === "reopen")
      ? naturalLead
      : null
  const shown = (key: BranchMenuItemKey) => {
    if (key === lead || !inPart(key)) return false
    if (key === "open-chat") return !!onOpenChat
    if (key === "logs") return !!onOpenLogs
    // A failed setup's Set up again stands in for the confirming one.
    if (key === "set-up-again" && naturalLead === "retry") return false
    // A Done chat's frames are hidden, so a frame never offers Reopen.
    if (key === "reopen" && part) return false
    if (key === "create-pr") return prReadiness.shown
    if (key === "pull-requests") return prs.length > 0
    if (!branch.doneAt) return true
    return !HIDDEN_WHILE_DONE.has(key)
  }
  const sections = BRANCH_MENU_SECTIONS.map((section) => ({
    id: section.id,
    itemKeys: section.itemKeys.filter(shown),
  }))
  // Open chat comes before even the lead: it's where the rest lead to.
  const groups = [
    ...sections.filter((section) => section.id === "open"),
    ...(lead ? [{ id: "lead", itemKeys: [lead] }] : []),
    ...sections.filter((section) => section.id !== "open"),
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
