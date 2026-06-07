"use client"

import { Fragment, type ReactNode } from "react"
import {
  ExternalLink,
  GitBranchPlus,
  GitMerge,
  Palette,
  Pencil,
  Play,
  RefreshCw,
  Route,
  Trash2,
} from "lucide-react"
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { cn } from "@workspace/ui/lib/utils"
import { BRANCH_COLORS } from "@/lib/branch-colors"
import type { BranchData, RepoData } from "@/lib/types"

/**
 * Stable key for one branch-menu action. Sections reference these so the
 * rendered order and the structural skeleton stay in lock-step — a later
 * slice that adds an action declares its key in {@link BRANCH_MENU_SECTIONS}
 * and supplies the node, rather than threading it into the middle of a giant
 * JSX block.
 */
export type BranchMenuItemKey =
  | "rename"
  | "color"
  | "play"
  | "routes"
  | "duplicate"
  | "restart"
  | "rebase"
  | "open-github"
  | "delete"

export type BranchMenuSectionId =
  | "identity"
  | "preview"
  | "branch-sandbox"
  | "git"
  | "danger"

export interface BranchMenuSection {
  id: BranchMenuSectionId
  label: string
  /** Item keys owned by this section, in display order. */
  itemKeys: BranchMenuItemKey[]
}

/**
 * The Branch overflow ("…") menu skeleton (#350): five labelled sections in a
 * fixed order, each owning the existing actions it inherits. This is the
 * structural spine the later epic-#349 slices slot new items into — adding an
 * action means appending its key to a section here (and rendering its node in
 * {@link BranchOverflowMenuContent}), never reordering the sections.
 *
 * `fetch`/`pull`/`push`/`sync` are deliberately absent: the always-commit-and-
 * push Engine loop makes them redundant.
 */
export const BRANCH_MENU_SECTIONS: readonly BranchMenuSection[] = [
  { id: "identity", label: "Identity", itemKeys: ["rename", "color"] },
  { id: "preview", label: "Preview", itemKeys: ["play", "routes"] },
  {
    id: "branch-sandbox",
    label: "Branch & sandbox",
    itemKeys: ["duplicate", "restart"],
  },
  { id: "git", label: "Git", itemKeys: ["rebase", "open-github"] },
  { id: "danger", label: "Danger", itemKeys: ["delete"] },
]

export interface BranchOverflowMenuContentProps {
  branch: BranchData
  repo: RepoData
  onPlay: (branchId: string) => void
  /** Opens the inline branch-name editor — already bound to this branch. */
  onRename: () => void
  onUpdateBranch: (id: string, data: Partial<BranchData>) => void
  onDuplicate: (branchId: string) => void
  onRestart: (branchId: string) => void
  onShowRoutes: (branchId: string) => void
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
 * Renders the Branch overflow menu's `<DropdownMenuContent>` from {@link
 * BRANCH_MENU_SECTIONS}. Each item's behaviour, disable condition, and routing
 * are unchanged from the pre-#350 inline menu — this component only groups them
 * under section labels with separators between sections.
 */
export function BranchOverflowMenuContent({
  branch,
  repo,
  onPlay,
  onRename,
  onUpdateBranch,
  onDuplicate,
  onRestart,
  onShowRoutes,
  onRebase,
  onDelete,
  onCloseAutoFocus,
  isBusy = false,
}: BranchOverflowMenuContentProps) {
  const nodes: Record<BranchMenuItemKey, ReactNode> = {
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
    duplicate: (
      <DropdownMenuItem onClick={() => onDuplicate(branch.id)}>
        <GitBranchPlus />
        Duplicate branch
      </DropdownMenuItem>
    ),
    restart: (
      <DropdownMenuItem onClick={() => onRestart(branch.id)}>
        <RefreshCw />
        Restart
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
          window.open(url, "_blank", "noopener,noreferrer")
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

  return (
    <DropdownMenuContent
      side="right"
      align="start"
      className="w-48"
      onCloseAutoFocus={onCloseAutoFocus}
    >
      {BRANCH_MENU_SECTIONS.map((section, i) => (
        <Fragment key={section.id}>
          {i > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuLabel>{section.label}</DropdownMenuLabel>
          {section.itemKeys.map((key) => (
            <Fragment key={key}>{nodes[key]}</Fragment>
          ))}
        </Fragment>
      ))}
    </DropdownMenuContent>
  )
}
