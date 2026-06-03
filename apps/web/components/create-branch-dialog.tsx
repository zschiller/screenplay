"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronsUpDown, GitBranch, Plus, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
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
  summarizeRow,
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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New Workspace</DialogTitle>
          <DialogDescription>
            Start a fresh Branch — submit an empty prompt for a bare scratch
            Branch. Add more rows to fan out several Branches at once. Press ⌘↵
            to create.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
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
              onFocusRow={() => setFocusedIndex(idx)}
              onRemove={() => removeRowAt(idx)}
              onBaseChange={(branch) => updateRow(idx, { baseBranch: branch })}
              onModelChange={(model) => updateRow(idx, { model })}
              onPlanModeChange={(planMode) => updateRow(idx, { planMode })}
              onPromptChange={(prompt) => updateRow(idx, { prompt })}
              onSubmitAll={submitAll}
            />
          ))}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start text-xs"
            onClick={addRow}
          >
            <Plus />
            Add another
          </Button>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submitAll}>
            {rows.length === 1
              ? "Create Branch"
              : `Create ${rows.length} Branches`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface WorkspaceRowProps {
  row: ComposerRow
  /** The focused row expands to the full Composer; the rest collapse to a summary. */
  focused: boolean
  /** Whether a remove control is offered (hidden when a single row remains). */
  canRemove: boolean
  models: ModelInfo[]
  skills: SkillMenuItem[]
  skillsLoading: boolean
  markdownLayers: MarkdownLayerData[]
  repoOwner: string
  repoName: string
  onFocusRow: () => void
  onRemove: () => void
  onBaseChange: (branch: string) => void
  onModelChange: (model: string) => void
  onPlanModeChange: (planMode: boolean) => void
  onPromptChange: (prompt: string) => void
  onSubmitAll: () => void
}

/**
 * One row of the New Workspace dialog (#327). When focused it expands to the
 * full Composer (base chip + model picker + plan toggle + draft); otherwise it
 * collapses to a one-line summary that expands on click.
 *
 * The Composer stays mounted even while collapsed — hidden, not unmounted — so
 * its live draft (including `@`-mention pills, which a plain-text round-trip
 * couldn't restore) survives expanding and collapsing. The collapsed summary's
 * prompt preview is fed by the Composer's `onChange` mirror into row state.
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
  onFocusRow,
  onRemove,
  onBaseChange,
  onModelChange,
  onPlanModeChange,
  onPromptChange,
  onSubmitAll,
}: WorkspaceRowProps) {
  const composerRef = useRef<ComposerHandle>(null)
  const [basePickerOpen, setBasePickerOpen] = useState(false)

  // Focus the Composer when this row gains focus (and on first mount of the
  // initially-focused row), once the body is no longer hidden.
  useEffect(() => {
    if (!focused) return
    const id = requestAnimationFrame(() => composerRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [focused])

  const modelLabel = models.find((m) => m.id === row.model)?.label ?? row.model

  return (
    <div className="rounded-lg border border-border bg-background">
      {!focused && (
        <button
          type="button"
          onClick={onFocusRow}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
          title="Edit this branch"
        >
          <GitBranch className="size-3.5 shrink-0 opacity-60" />
          <span className="truncate">{summarizeRow(row, modelLabel)}</span>
        </button>
      )}

      {/* Kept mounted but hidden when collapsed so the draft persists. */}
      <div className={focused ? "flex flex-col gap-2 p-2" : "hidden"}>
        <div className="flex items-center gap-2">
          <Popover open={basePickerOpen} onOpenChange={setBasePickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="Choose the base branch"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <GitBranch className="size-3.5" />
                <span className="font-mono">{row.baseBranch}</span>
                <ChevronsUpDown className="size-3 opacity-60" />
              </button>
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
          placeholder="Describe a task, or leave empty for a bare branch…"
          className="relative rounded-lg border border-border"
        />
      </div>
    </div>
  )
}
