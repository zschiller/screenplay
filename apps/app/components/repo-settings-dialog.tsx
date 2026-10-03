"use client"

import { useCallback, useState } from "react"
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
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { RepoSettingsFields } from "@/components/repo-settings-fields"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { isCustomized, runSettings } from "@/lib/repository-library"
import type { RepoData } from "@/lib/types"

/**
 * A Repo's run settings (label, scripts, port, env vars), edited in place on
 * the canvas so every collaborator's new Workspaces start from them. Opened by
 * Edit in Canvas settings and by Settings on the sidebar's repository row.
 * Saving changes this canvas only; given the `repository` it links to and
 * differs from, the footer offers Reset to Settings (#1424).
 */
export function RepoSettingsDialog({
  repo,
  repository,
  open,
  onOpenChange,
  onUpdate,
}: {
  repo: RepoData | null
  /** The Repository (Settings) this Repo is linked to, when it's yours. */
  repository?: RepoConfig
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (id: string, data: Partial<RepoData>) => void
}) {
  return (
    <Dialog open={open && !!repo} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg"
        // Opened from inside the sidebar's dnd-kit sortable row: stop key and
        // pointer events from bubbling (React tree, through the portal) to the
        // row's sensors. The KeyboardSensor otherwise swallows Space in these
        // fields, and the PointerSensor otherwise treats a drag on the modal as
        // a drag of the row.
        onKeyDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {repo && (
          <RepoSettingsForm
            // A fresh form per repository, so switching rows never shows the
            // last one's unsaved edits.
            key={repo.id}
            repo={repo}
            repository={repository}
            onUpdate={onUpdate}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RepoSettingsForm({
  repo,
  repository,
  onUpdate,
  onClose,
}: {
  repo: RepoData
  repository?: RepoConfig
  onUpdate: (id: string, data: Partial<RepoData>) => void
  onClose: () => void
}) {
  const [name, setName] = useState(repo.name ?? "")
  const [setupScript, setSetupScript] = useState(repo.setupScript)
  const [devScript, setDevScript] = useState(repo.devScript)
  const [devServerPort, setDevServerPort] = useState(
    String(repo.devServerPort ?? 3000)
  )
  const [envVars, setEnvVars] = useState(repo.envVars)
  const [copyPatterns, setCopyPatterns] = useState(repo.copyPatterns ?? "")
  const [defaultIframeLayerSizeId, setDefaultIframeLayerSizeId] = useState(
    repo.defaultIframeLayerSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID
  )
  const [systemPrompt, setSystemPrompt] = useState(repo.systemPrompt ?? "")

  const parsedPort = Number.parseInt(devServerPort, 10)
  const portIsValid =
    Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort < 65536

  const trimmedSystemPrompt = systemPrompt.trim()

  const handleSave = useCallback(() => {
    if (!portIsValid) return
    onUpdate(repo.id, {
      name: name.trim(),
      setupScript,
      devScript,
      devServerPort: parsedPort,
      envVars,
      copyPatterns: copyPatterns.trim() ? copyPatterns : undefined,
      defaultIframeLayerSizeId,
      systemPrompt: trimmedSystemPrompt || undefined,
    })
    onClose()
  }, [
    repo.id,
    name,
    setupScript,
    devScript,
    parsedPort,
    portIsValid,
    envVars,
    copyPatterns,
    defaultIframeLayerSizeId,
    trimmedSystemPrompt,
    onUpdate,
    onClose,
  ])

  const hasChanges =
    name.trim() !== (repo.name ?? "") ||
    setupScript !== repo.setupScript ||
    devScript !== repo.devScript ||
    parsedPort !== (repo.devServerPort ?? 3000) ||
    envVars !== repo.envVars ||
    copyPatterns !== (repo.copyPatterns ?? "") ||
    defaultIframeLayerSizeId !==
      (repo.defaultIframeLayerSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID) ||
    trimmedSystemPrompt !== (repo.systemPrompt ?? "")

  return (
    <>
      <DialogHeader>
        <DialogTitle>Repository settings</DialogTitle>
        <DialogDescription>
          Defaults for new workspaces of {repo.repoFullName} on this canvas.
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-5 flex max-h-[60vh] flex-col gap-5 overflow-y-auto px-5">
        <Field>
          <FieldLabel htmlFor="repo-settings-name">Label</FieldLabel>
          <Input
            id="repo-settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={repo.repoFullName}
          />
          <FieldDescription>
            A short name for this repository, like “web” or “api”.
          </FieldDescription>
        </Field>

        <RepoSettingsFields
          idPrefix="repo-settings"
          setupScript={setupScript}
          onSetupScriptChange={setSetupScript}
          devScript={devScript}
          onDevScriptChange={setDevScript}
          devServerPort={devServerPort}
          onDevServerPortChange={setDevServerPort}
          envVars={envVars}
          onEnvVarsChange={setEnvVars}
          copyPatterns={copyPatterns}
          onCopyPatternsChange={setCopyPatterns}
          defaultIframeLayerSizeId={defaultIframeLayerSizeId}
          onDefaultIframeLayerSizeIdChange={setDefaultIframeLayerSizeId}
          systemPrompt={systemPrompt}
          onSystemPromptChange={setSystemPrompt}
        />
      </div>

      <DialogFooter>
        {repository && isCustomized(repo, repository) && (
          <Button
            variant="outline"
            size="sm"
            className="sm:mr-auto"
            onClick={() => {
              onUpdate(repo.id, {
                name: repository.name,
                ...runSettings(repository),
              })
              onClose()
            }}
          >
            Reset to Settings
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges || !portIsValid}
        >
          Save
        </Button>
      </DialogFooter>
    </>
  )
}
