"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, GitBranch, Plus, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Kbd } from "@workspace/ui/components/kbd"
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
import { getSkillMenuItems, type SkillMenuItem } from "@/lib/skills-store"
import type { ComposerSpec } from "@/lib/branch-create-planner"
import {
  appendClonedRow,
  focusAfterRemove,
  initialRows,
  removeRow,
  type ComposerRow,
} from "@/lib/composer-rows"
import type { MarkdownLayerData } from "@/lib/types"

const LAST_MODEL_STORAGE_KEY = "agent-last-model"

function readStoredModel(): string | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(LAST_MODEL_STORAGE_KEY)
  } catch {
    return null
  }
}

// Process-wide source of stable row keys. A module counter (rather than a ref
// read during render) keeps the seed pure from React's view; skipped numbers
// across dialog instances are harmless — keys only need to be unique.
let rowKeySeq = 0
function nextRowKey(): string {
  return `row-${rowKeySeq++}`
}

interface CreateBranchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The Repo's default branch — the base each row starts on and the dividing
   * line the planner reads to derive the flow: submitting on the default branch
   * is `"new"`, any other base is `"duplicate-branch"` (#325).
   */
  defaultBranch: string
  /** Repo identity, used to fetch the searchable branch list for the base picker. */
  repoOwner: string
  repoName: string
  /**
   * The Room's Markdown Layers — the `@`-mention source for a non-empty seed
   * prompt. Empty before any Layer exists; mentions serialize through the
   * Composer's Message-Markers codec into the submitted text.
   */
  markdownLayers: MarkdownLayerData[]
  /**
   * Fired with one resolved {@link ComposerSpec} per row when the user submits.
   * A single row is the common case; parallel mode (#327) hands several, which
   * the caller resolves one create per Branch.
   */
  onSubmit: (specs: ComposerSpec[]) => void
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
  defaultBranch,
  repoOwner,
  repoName,
  markdownLayers,
  onSubmit,
}: CreateBranchDialogProps) {
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

  // Stored model (the user's last-used pick) wins over the server default; see
  // `resolveDefaultModel` for the full precedence and stale-id guarding.
  const initialModel = resolveDefaultModel({
    stored: readStoredModel(),
    serverDefault: serverDefaultModel,
    models,
  })

  // Seed the rows from the chosen base + resolved default, re-seeding (back to
  // a single fresh row) whenever the dialog reopens or the resolved seed values
  // change — the render-phase previous-value pattern, as in the prior dialog.
  const [rows, setRows] = useState<ComposerRow[]>(() =>
    initialRows(defaultBranch, initialModel, nextRowKey)
  )
  const [focusedIndex, setFocusedIndex] = useState(0)
  const rowSeedKey = `${open}|${defaultBranch}|${initialModel}`
  const [prevRowSeedKey, setPrevRowSeedKey] = useState(rowSeedKey)
  if (rowSeedKey !== prevRowSeedKey) {
    setPrevRowSeedKey(rowSeedKey)
    if (open) {
      setRows(initialRows(defaultBranch, initialModel, nextRowKey))
      setFocusedIndex(0)
    }
  }

  const updateRow = (idx: number, patch: Partial<ComposerSpec>) => {
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
        <DialogHeader className="px-4 pt-4 pb-3">
          <DialogTitle>Create branches</DialogTitle>
          <DialogDescription>
            Create one or more branches, each with an optional prompt.
          </DialogDescription>
        </DialogHeader>

        <div ref={scrollWrapRef} className="relative">
          {/* A single box-shadow draws both the hairline (the crisp 0 1px 0 line)
              and the soft drop beneath it — revealed only while content is tucked
              under the header. */}
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-x-0 top-0 z-10 h-px shadow-[inset_0_1px_0_0_rgb(0_0_0/0.08),0_3px_8px_0_rgb(0_0_0/0.06)] transition-opacity duration-150 dark:shadow-[inset_0_1px_0_0_rgb(255_255_255/0.1),0_3px_8px_0_rgb(255_255_255/0.06)]",
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
            <div className="flex flex-col gap-4 px-4 pt-2 pb-4">
              {rows.map((row, idx) => (
                <WorkspaceRow
                  key={row.key}
                  row={row}
                  focused={idx === focusedIndex}
                  canRemove={rows.length > 1}
                  models={models}
                  skills={skills}
                  skillsLoading={skillsLoading}
                  markdownLayers={markdownLayers}
                  repoOwner={repoOwner}
                  repoName={repoName}
                  onRemove={() => removeRowAt(idx)}
                  onBaseChange={(branch) =>
                    updateRow(idx, { baseBranch: branch })
                  }
                  onModelChange={(model) => updateRow(idx, { model })}
                  onPlanModeChange={(planMode) => updateRow(idx, { planMode })}
                  onPromptChange={(prompt) => updateRow(idx, { prompt })}
                  onSubmitAll={submitAll}
                />
              ))}

              <Button
                type="button"
                variant="outline"
                className="self-start"
                onClick={addRow}
              >
                <Plus />
                Add another
              </Button>
            </div>
          </ScrollArea>
        </div>

        <DialogFooter className="mx-0 mb-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submitAll}>
            {rows.length === 1
              ? "Create branch"
              : `Create ${rows.length} branches`}
            <Kbd>⌘↵</Kbd>
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
  skills: SkillMenuItem[]
  skillsLoading: boolean
  markdownLayers: MarkdownLayerData[]
  repoOwner: string
  repoName: string
  onRemove: () => void
  onBaseChange: (branch: string) => void
  onModelChange: (model: string) => void
  onPlanModeChange: (planMode: boolean) => void
  onPromptChange: (prompt: string) => void
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
  skills,
  skillsLoading,
  markdownLayers,
  repoOwner,
  repoName,
  onRemove,
  onBaseChange,
  onModelChange,
  onPlanModeChange,
  onPromptChange,
  onSubmitAll,
}: WorkspaceRowProps) {
  const composerRef = useRef<ComposerHandle>(null)
  const [basePickerOpen, setBasePickerOpen] = useState(false)

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
        <div className="flex items-center gap-2">
          <Popover open={basePickerOpen} onOpenChange={setBasePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                title="Choose the base branch"
              >
                <GitBranch className="size-3.5" />
                <span className="font-mono">{row.baseBranch}</span>
                <ChevronDown className="size-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start">
              <BranchPicker
                owner={repoOwner}
                repo={repoName}
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
              <Trash2 />
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
          onModelChange={onModelChange}
          planMode={row.planMode}
          onPlanModeChange={onPlanModeChange}
          onChange={(payload) => onPromptChange(payload.text)}
          // A submit from any row creates every row — there's one logical
          // create action — so ⌘↵ in the focused Composer commits the stack.
          onSubmit={onSubmitAll}
          submitMode="mod-enter"
          allowEmptySubmit
          hideSend
          placeholder="Describe a task, or leave empty for a bare branch…"
          className="relative"
        />
      </div>
    </div>
  )
}
