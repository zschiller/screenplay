"use client"

import { useEffect, useRef, useState } from "react"
import { GitBranch } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Composer,
  type ComposerHandle,
  type ComposerSubmitPayload,
} from "@/components/agent/composer"
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
   * The Repo's default branch. This slice always bases off it (base selection
   * lands in a later slice); the chip below surfaces it, and the planner reads
   * it to derive the `"new"` flow.
   */
  defaultBranch: string
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
 * the Composer's own `Model` picker as the model chip. The dialog hands a single
 * {@link ComposerSpec} (prompt, model, base, plan-mode) up to the caller, which
 * runs it through the pure planner:
 *
 *  - An **empty prompt** creates a bare Branch off the default branch (random
 *    name, `flow:"new"`, no Chat Session, nothing fired).
 *  - A **non-empty prompt** (#324) drives the full seeded path: a Branch name
 *    derived from the prompt, a Chat Session pre-seeded with the chosen model,
 *    and the prompt fired as the first message once the Sandbox is `running`.
 *    `@`-Layer mentions and `/`-Skills (App Skills only, pre-Sandbox) serialize
 *    through the Composer's Message-Markers codec into the submitted text.
 *
 * Base selection and parallel mode arrive in later slices.
 */
export function CreateBranchDialog({
  open,
  onOpenChange,
  defaultBranch,
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

  // Load the model catalog + server default while the dialog is open, mirroring
  // ParallelCreateDialog.
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
  // the render-phase previous-value pattern, as in ParallelCreateDialog.
  const [model, setModel] = useState(initialModel)
  const modelSeedKey = `${open}|${initialModel}`
  const [prevModelSeedKey, setPrevModelSeedKey] = useState(modelSeedKey)
  if (modelSeedKey !== prevModelSeedKey) {
    setPrevModelSeedKey(modelSeedKey)
    if (open) setModel(initialModel)
  }

  // Open focused on the Composer — the prompt-first surface (ADR 0004).
  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => composerRef.current?.focus())
    return () => cancelAnimationFrame(id)
  }, [open])

  const handleSubmit = (payload: ComposerSubmitPayload) => {
    onSubmit({
      baseBranch: defaultBranch,
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
            Start a fresh Branch off{" "}
            <span className="font-mono">{defaultBranch}</span>. Submit an empty
            prompt for a bare scratch Branch. Press ⌘↵ to create.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled
            title="Base branch — selection coming soon"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
          >
            <GitBranch className="size-3.5" />
            <span className="font-mono">{defaultBranch}</span>
          </button>
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
