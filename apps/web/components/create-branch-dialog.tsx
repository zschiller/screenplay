"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronsUpDown, GitBranch } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"
import {
  Composer,
  type ComposerHandle,
  type ComposerSubmitPayload,
} from "@/components/agent/composer"
import { BranchPicker } from "@/components/branch-picker"
import {
  getDefaultModelId,
  getModels,
  type ModelInfo,
} from "@/lib/models-store"
import { resolveDefaultModel } from "@/lib/model-selection"
import { getSkillMenuItems, type SkillMenuItem } from "@/lib/skills-store"
import type { ComposerSpec } from "@/lib/branch-create-planner"
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

interface CreateBranchDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The Repo's default branch — the base the dialog starts on and the dividing
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
  /** Fired with the resolved Composer spec when the user submits. */
  onSubmit: (spec: ComposerSpec) => void
}

/**
 * The prompt-first "New Workspace" dialog (ADR 0004, PRD #314).
 *
 * Opens focused on the shared {@link Composer} with a `Base` chip beside it and
 * the Composer's own `Model` picker as the model chip. The base chip defaults to
 * the Repo's default branch and opens a searchable {@link BranchPicker} only when
 * activated, so choosing a base is available but never in the way (#325). The
 * dialog hands a single {@link ComposerSpec} (prompt, model, base, plan-mode) up
 * to the caller, which runs it through the pure planner:
 *
 *  - An **empty prompt** creates a bare Branch (random name, no Chat Session,
 *    nothing fired).
 *  - A **non-empty prompt** (#324) drives the full seeded path: a Branch name
 *    derived from the prompt, a Chat Session pre-seeded with the chosen model,
 *    and the prompt fired as the first message once the Sandbox is `running`.
 *    `@`-Layer mentions and `/`-Skills (App Skills only, pre-Sandbox) serialize
 *    through the Composer's Message-Markers codec into the submitted text.
 *
 * The chosen base rides on the spec regardless of prompt content; the planner
 * derives the flow from it (default branch → `"new"`, any other base →
 * `"duplicate-branch"`), so the user never sees a copy-vs-new verb. Parallel
 * mode arrives in a later slice.
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
  // Plan-mode for the seed turn. Reset on each open by mounting fresh — the
  // dialog is conditionally rendered by its caller, so a fresh open starts here.
  const [planMode, setPlanMode] = useState(false)
  const composerRef = useRef<ComposerHandle>(null)

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
  // `skillsLoading` starts true and is cleared from the async callback — the
  // dialog mounts fresh on open, so there's no synchronous flip to make here.
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

  // Seed the selected model from the resolved default, re-seeding if the
  // resolved value changes while open (e.g. the catalog finishes loading) —
  // the render-phase previous-value pattern.
  const [model, setModel] = useState(initialModel)
  const modelSeedKey = `${open}|${initialModel}`
  const [prevModelSeedKey, setPrevModelSeedKey] = useState(modelSeedKey)
  if (modelSeedKey !== prevModelSeedKey) {
    setPrevModelSeedKey(modelSeedKey)
    if (open) setModel(initialModel)
  }

  // The chosen base. Defaults to the Repo's default branch and re-seeds each
  // time the dialog opens (or the default branch changes), so a previous fork
  // selection never leaks into the next open.
  const [base, setBase] = useState(defaultBranch)
  const [basePickerOpen, setBasePickerOpen] = useState(false)
  const baseSeedKey = `${open}|${defaultBranch}`
  const [prevBaseSeedKey, setPrevBaseSeedKey] = useState(baseSeedKey)
  if (baseSeedKey !== prevBaseSeedKey) {
    setPrevBaseSeedKey(baseSeedKey)
    if (open) setBase(defaultBranch)
  }

  // Open focused on the Composer — the prompt-first surface (ADR 0004).
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => composerRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  const handleSubmit = (payload: ComposerSubmitPayload) => {
    onSubmit({
      baseBranch: base,
      model: payload.model,
      prompt: payload.text,
      planMode,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New Workspace</DialogTitle>
          <DialogDescription>
            Start a fresh Branch off <span className="font-mono">{base}</span>.
            Submit an empty prompt for a bare scratch Branch. Press ⌘↵ to
            create.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Popover open={basePickerOpen} onOpenChange={setBasePickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="Choose the base branch"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <GitBranch className="size-3.5" />
                <span className="font-mono">{base}</span>
                <ChevronsUpDown className="size-3 opacity-60" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="start">
              <BranchPicker
                owner={repoOwner}
                repo={repoName}
                onSelect={(branch) => {
                  setBase(branch)
                  setBasePickerOpen(false)
                  composerRef.current?.focus()
                }}
              />
            </PopoverContent>
          </Popover>
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
          model={model}
          onModelChange={setModel}
          planMode={planMode}
          onPlanModeChange={setPlanMode}
          onSubmit={handleSubmit}
          submitMode="mod-enter"
          allowEmptySubmit
          placeholder="Describe a task, or leave empty for a bare branch…"
          className="relative rounded-lg border border-border"
        />
      </DialogContent>
    </Dialog>
  )
}
