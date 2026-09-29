"use client"

import { useEffect, useRef, useState } from "react"
import {
  BookBookmarkIcon,
  CaretDownIcon,
  GitBranchIcon,
  PlusIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"
import { Kbd, KbdGroup } from "@workspace/ui/components/kbd"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { cn } from "@workspace/ui/lib/utils"
import { Composer, type ComposerHandle } from "@/components/agent/composer"
import { BranchPicker } from "@/components/branch-picker"
import {
  getDefaultModelId,
  getModels,
  type ModelInfo,
} from "@/lib/models-store"
import { resolveDefaultModel } from "@/lib/model-selection"
import { useDefaultModel } from "@/lib/default-model-store"
import { getSkillMenuItems, type SkillMenuItem } from "@/lib/skills-store"
import type { ComposerSpec } from "@/lib/branch-create-planner"
import {
  appendClonedRow,
  focusAfterRemove,
  initialRows,
  removeRow,
  type ComposerRow,
} from "@/lib/composer-rows"
import { repoShortName } from "@/lib/repo-identity"
import type { MarkdownLayerData, RepoData } from "@/lib/types"

// Process-wide source of stable row keys. A module counter (rather than a ref
// read during render) keeps the seed pure from React's view; skipped numbers
// across dialog instances are harmless — keys only need to be unique.
let rowKeySeq = 0
function nextRowKey(): string {
  return `row-${rowKeySeq++}`
}

/** One row's create request: its {@link ComposerSpec} and the Repo it's in. */
export type WorkspaceSpec = ComposerSpec & { repoId: string }

interface CreateBranchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The canvas's Repos, in sidebar order. With several, each row gets a
   * repository chip beside its base chip (#884); with one, nothing mentions it.
   */
  repos: RepoData[]
  /**
   * The Repo every row starts in. Its default branch is the base each row
   * starts on and the dividing line the planner reads to derive the flow:
   * submitting on the default branch is `"new"`, any other base is
   * `"duplicate-branch"` (#325).
   */
  repoId: string
  /**
   * The base each row starts on. Defaults to the Repo's default branch; the
   * "New workspace from here…" menu item (#353) seeds it with the originating
   * branch's ref so the dialog opens pre-based on that branch (a base ≠ the
   * default resolves to the planner's `duplicate-branch` flow), still with an
   * empty prompt.
   */
  baseBranch?: string
  /**
   * The Room's Markdown Layers — the `@`-mention source for a non-empty seed
   * prompt. Empty before any Layer exists; mentions serialize through the
   * Composer's Message-Markers codec into the submitted text.
   */
  markdownLayers: MarkdownLayerData[]
  /**
   * Fired with one resolved {@link WorkspaceSpec} per row when the user
   * submits. A single row is the common case; parallel mode (#327) hands
   * several, which the caller resolves one create per Branch.
   */
  onSubmit: (specs: WorkspaceSpec[]) => void
}

/**
 * The prompt-first "New Workspace" dialog (ADR 0004, PRD #314).
 *
 * Opens focused on a single {@link Composer} row — a `Base` chip beside the
 * Composer's own `Model` picker. The base chip defaults to the Repo's default
 * branch and opens a searchable {@link BranchPicker} only when activated, so
 * choosing a base is available but never in the way (#325). Each row hands up
 * one {@link ComposerSpec} (prompt, model, base, plan-mode); the caller runs
 * every spec through the pure planner:
 *
 *  - An **empty prompt** creates a bare Branch (random name, no Chat Session,
 *    nothing fired).
 *  - A **non-empty prompt** (#324) drives the full seeded path: a Branch name
 *    derived from the prompt, a Chat Session pre-seeded with the chosen model,
 *    and the prompt fired as the first message once the Sandbox is `running`.
 *    `@`-Layer mentions and `/`-Skills (App Skills only, pre-Sandbox) serialize
 *    through the Composer's Message-Markers codec into the submitted text.
 *
 * **Parallel mode (#327)** is opt-in via "+ Add another", which appends a row
 * cloning the previous row's base and model with an empty prompt. Each row
 * carries its own independent `{ baseBranch, model, prompt, planMode }`; the
 * focused row expands to the full Composer while the rest collapse to a
 * one-line `base · model · prompt preview` summary so a stack stays scannable.
 * On submit every row becomes its own {@link ComposerSpec}, resolved
 * independently by the planner — a mix of bare and seeded Branches across rows
 * is created in one action.
 */
export function CreateBranchDialog({
  open,
  onOpenChange,
  repos,
  repoId,
  baseBranch,
  markdownLayers,
  onSubmit,
}: CreateBranchDialogProps) {
  const seedRepo = repos.find((r) => r.id === repoId) ?? repos[0]
  // The base each row seeds on: the explicit `baseBranch` (the "New branch from
  // here…" source, #353) when given, else the Repo default.
  const seedBase = baseBranch ?? seedRepo?.defaultBranch ?? ""
  const [models, setModels] = useState<ModelInfo[]>([])
  const [serverDefaultModel, setServerDefaultModel] = useState<string | null>(
    null
  )
  const [skills, setSkills] = useState<SkillMenuItem[]>([])
  const [skillsLoading, setSkillsLoading] = useState(true)

  // Load the model catalog + server default while the dialog is open.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    Promise.all([getModels(), getDefaultModelId()])
      .then(([list, def]) => {
        if (cancelled) return
        setModels(list)
        setServerDefaultModel(def)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [open])

  // Load the `/`-Skill menu while the dialog is open. There's no Sandbox yet,
  // so this is App Skills only (resolveSkillMenuSource with no Sandbox, #320);
  // `getSkillMenuItems()` with no sandbox returns exactly that App-only set.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    getSkillMenuItems()
      .then((list) => {
        if (!cancelled) setSkills(list)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSkillsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // The user's default from Settings wins over the server default; see
  // `resolveDefaultModel` for the full precedence and stale-id guarding.
  const userDefaultModel = useDefaultModel()
  const initialModel = resolveDefaultModel({
    stored: userDefaultModel,
    serverDefault: serverDefaultModel,
    models,
  })

  // Seed the rows from the chosen base + resolved default, re-seeding (back to
  // a single fresh row) whenever the dialog reopens or the resolved seed values
  // change — the render-phase previous-value pattern, as in the prior dialog.
  const [rows, setRows] = useState<ComposerRow[]>(() =>
    initialRows(seedBase, initialModel, nextRowKey, seedRepo?.id)
  )
  const [focusedIndex, setFocusedIndex] = useState(0)
  const rowSeedKey = `${open}|${seedRepo?.id}|${seedBase}|${initialModel}`
  const [prevRowSeedKey, setPrevRowSeedKey] = useState(rowSeedKey)
  if (rowSeedKey !== prevRowSeedKey) {
    setPrevRowSeedKey(rowSeedKey)
    if (open) {
      setRows(initialRows(seedBase, initialModel, nextRowKey, seedRepo?.id))
      setFocusedIndex(0)
    }
  }

  const updateRow = (idx: number, patch: Partial<ComposerRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  const addRow = () => {
    // The appended row lands at the current end, so focus follows it there.
    setFocusedIndex(rows.length)
    setRows((prev) => appendClonedRow(prev, nextRowKey))
  }

  const removeRowAt = (idx: number) => {
    const nextLength = Math.max(1, rows.length - 1)
    setRows((prev) => removeRow(prev, idx))
    setFocusedIndex((f) => focusAfterRemove(f, idx, nextLength))
  }

  // Reveal a hairline + shadow under the header once the scroll body has moved
  // off its top — the boundary only needs to assert itself while content sits
  // tucked beneath the header. The viewport is Radix-owned, so we reach it by
  // data-slot off the wrapper rather than threading a ref through ScrollArea.
  const scrollWrapRef = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    if (!open) return
    const viewport = scrollWrapRef.current?.querySelector<HTMLDivElement>(
      "[data-slot=scroll-area-viewport]"
    )
    if (!viewport) return
    const onScroll = () => setScrolled(viewport.scrollTop > 0)
    onScroll()
    viewport.addEventListener("scroll", onScroll, { passive: true })
    return () => viewport.removeEventListener("scroll", onScroll)
    // `rows` re-runs the lookup after the viewport (re)mounts with new content.
  }, [open, rows])

  const submitAll = () => {
    // Drop the row's React `key` — the planner only wants the spec fields.
    onSubmit(
      rows.map((row) => ({
        repoId: row.repoId ?? seedRepo?.id ?? "",
        baseBranch: row.baseBranch,
        model: row.model,
        prompt: row.prompt,
        planMode: row.planMode,
      }))
    )
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle>Create workspaces</DialogTitle>
          <DialogDescription>
            Create one or more workspaces, each with an optional prompt.
          </DialogDescription>
        </DialogHeader>

        <div ref={scrollWrapRef} className="relative">
          {/* A hairline, revealed only while content is tucked under the
              header. */}
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-border transition-opacity duration-150",
              scrolled ? "opacity-100" : "opacity-0"
            )}
          />
          {/* The max-height must land on the Radix viewport itself — shadcn
              hardcodes h-full on it, so a max-h on the outer ScrollArea only
              shrinks-to-fit and never creates a scroll boundary (shadcn #296,
              radix #2307). Targeting the viewport gives it the overflow cap. */}
          <ScrollArea
            orientation="vertical"
            className="[&>[data-slot=scroll-area-viewport]]:max-h-[60vh]"
          >
            <div className="flex flex-col gap-4 px-5 pb-4">
              {rows.map((row, idx) => (
                <WorkspaceRow
                  key={row.key}
                  row={row}
                  focused={idx === focusedIndex}
                  canRemove={rows.length > 1}
                  models={models}
                  defaultModel={initialModel}
                  skills={skills}
                  skillsLoading={skillsLoading}
                  markdownLayers={markdownLayers}
                  repos={repos}
                  onRemove={() => removeRowAt(idx)}
                  onRepoChange={(repo) =>
                    // A new repository starts on its own default branch.
                    updateRow(idx, {
                      repoId: repo.id,
                      baseBranch: repo.defaultBranch,
                    })
                  }
                  onBaseChange={(branch) =>
                    updateRow(idx, { baseBranch: branch })
                  }
                  onModelChange={(model) => updateRow(idx, { model })}
                  onPlanModeChange={(planMode) => updateRow(idx, { planMode })}
                  onPromptChange={(prompt) => updateRow(idx, { prompt })}
                  onAddRow={addRow}
                  onSubmitAll={submitAll}
                />
              ))}

              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={addRow}
              >
                <PlusIcon />
                Add another
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>↵</Kbd>
                </KbdGroup>
              </Button>
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="px-5 pb-5">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submitAll}>
            {rows.length === 1
              ? "Create workspace"
              : `Create ${rows.length} workspaces`}
            <Kbd>↵</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface WorkspaceRowProps {
  row: ComposerRow
  /** The focused row auto-focuses its Composer (the initial row, or one just added). */
  focused: boolean
  /** Whether a remove control is offered (hidden when a single row remains). */
  canRemove: boolean
  models: ModelInfo[]
  /** The model new Workspaces start from, so a row on another one says so. */
  defaultModel: string
  skills: SkillMenuItem[]
  skillsLoading: boolean
  markdownLayers: MarkdownLayerData[]
  /** The canvas's Repos; the row offers a repository chip when there are several. */
  repos: RepoData[]
  onRemove: () => void
  onRepoChange: (repo: RepoData) => void
  onBaseChange: (branch: string) => void
  onModelChange: (model: string) => void
  onPlanModeChange: (planMode: boolean) => void
  onPromptChange: (prompt: string) => void
  /** Append a new row — Enter in the Composer stacks one, like "Add another". */
  onAddRow: () => void
  onSubmitAll: () => void
}

/**
 * One row of the New Workspace dialog (#327): the full Composer (base chip +
 * model picker + plan toggle + draft). Every row stays expanded — a stack of
 * Branches is edited side by side, never collapsed — so each carries its own
 * independent base/model/prompt visible at once.
 */
function WorkspaceRow({
  row,
  focused,
  canRemove,
  models,
  defaultModel,
  skills,
  skillsLoading,
  markdownLayers,
  repos,
  onRemove,
  onRepoChange,
  onBaseChange,
  onModelChange,
  onPlanModeChange,
  onPromptChange,
  onAddRow,
  onSubmitAll,
}: WorkspaceRowProps) {
  const composerRef = useRef<ComposerHandle>(null)
  const [basePickerOpen, setBasePickerOpen] = useState(false)
  const repo = repos.find((r) => r.id === row.repoId) ?? repos[0]

  // Focus the Composer when this row becomes the focused one — on first mount of
  // the initial row and when a freshly-added row lands.
  useEffect(() => {
    if (!focused) return
    const id = requestAnimationFrame(() => composerRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [focused])

  return (
    <div>
      <div className="flex flex-col gap-0.5">
        {/* -ml-2 cancels the ghost pickers' padding so the first icon sits
            on the dialog gutter with the title and the prompt box. */}
        <div className="-ml-2 flex items-center gap-1">
          {repos.length > 1 && repo ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  title="Choose the repository"
                >
                  <BookBookmarkIcon className="size-3.5" />
                  {repoShortName(repo)}
                  <CaretDownIcon className="size-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                // Hand focus back to the prompt, like the base picker does.
                onCloseAutoFocus={(event) => {
                  event.preventDefault()
                  composerRef.current?.focus()
                }}
              >
                <DropdownMenuRadioGroup
                  value={repo.id}
                  onValueChange={(id) => {
                    const next = repos.find((r) => r.id === id)
                    if (next && next.id !== repo.id) onRepoChange(next)
                  }}
                >
                  {repos.map((r) => (
                    <DropdownMenuRadioItem key={r.id} value={r.id}>
                      {repoShortName(r)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Popover open={basePickerOpen} onOpenChange={setBasePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                title="Choose the base branch"
              >
                <GitBranchIcon className="size-3.5" />
                <span className="font-mono">{row.baseBranch}</span>
                <CaretDownIcon className="size-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start">
              <BranchPicker
                owner={repo?.repoOwner ?? ""}
                repo={repo?.repoName ?? ""}
                onSelect={(branch) => {
                  onBaseChange(branch)
                  setBasePickerOpen(false)
                  composerRef.current?.focus()
                }}
              />
            </PopoverContent>
          </Popover>
          <div className="flex-1" />
          {canRemove && (
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              title="Remove this row"
              onClick={onRemove}
            >
              <TrashIcon />
            </Button>
          )}
        </div>

        <Composer
          ref={composerRef}
          // A non-empty seed prompt is a real chat turn: `@`-Layer mentions and
          // `/`-Skills are enabled and serialize through the Message-Markers
          // codec into the submitted text, exactly as in a live chat.
          markdownLayers={markdownLayers}
          skills={skills}
          skillsLoading={skillsLoading}
          enableSkills
          models={models}
          model={row.model}
          defaultModel={defaultModel}
          onModelChange={onModelChange}
          planMode={row.planMode}
          onPlanModeChange={onPlanModeChange}
          onChange={(payload) => onPromptChange(payload.text)}
          // A submit from any row creates every row — there's one logical
          // create action — so Enter in the focused Composer commits the stack.
          onSubmit={onSubmitAll}
          submitMode="mod-enter"
          // ⌘↵ stacks another row (mirrors the "Add another" button);
          // Shift+Enter is a newline, Enter creates the whole stack.
          onEnter={onAddRow}
          // Backspace/Delete on an emptied row pops it off the stack — but not
          // the last remaining row, which has nothing to fall back to.
          onRemoveWhenEmpty={canRemove ? onRemove : undefined}
          allowEmptySubmit
          hideSend
          className="relative"
        />
      </div>
    </div>
  )
}
