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
import type { ComposerSpec } from "@/lib/branch-create-planner"

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
  /** Fired with the resolved Composer spec when the user submits. */
  onSubmit: (spec: ComposerSpec) => void
}

/**
 * The prompt-first "New Workspace" dialog (ADR 0004, PRD #314).
 *
 * Opens focused on the shared {@link Composer} with a `Base` chip beside it and
 * the Composer's own `Model` picker as the model chip. This first slice wires
 * the empty-prompt case end to end: submitting an empty prompt hands a single
 * {@link ComposerSpec} up to the caller, which runs it through the pure planner
 * to create a bare Branch off the default branch (random name, `flow:"new"`, no
 * Chat Session). Non-empty prompts, base selection, and parallel mode arrive in
 * later slices.
 */
export function CreateBranchDialog({
  open,
  onOpenChange,
  defaultBranch,
  onSubmit,
}: CreateBranchDialogProps) {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [serverDefaultModel, setServerDefaultModel] = useState<string | null>(
    null
  )
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
          // `@`-Layer mentions matter only for non-empty seed prompts, which
          // are a later slice; this empty-prompt cut needs no mention source.
          markdownLayers={[]}
          models={models}
          model={model}
          onModelChange={setModel}
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
