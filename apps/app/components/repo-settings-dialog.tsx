"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Dialog, DialogContent } from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  REPO_DIALOG_CONTENT,
  RepoDialogBody,
  RepoDialogFooter,
  RepoDialogHeader,
} from "@/components/repo-dialog-layout"
import { RepoSettingsFields } from "@/components/repo-settings-fields"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { resetCanvasRepoEnv, saveCanvasRepoEnv } from "@/lib/repo-env/actions"
import { useCanvasRepoEnvField } from "@/lib/repo-env/use-env-field"
import { isCustomized, repositorySettings } from "@/lib/repository-library"
import type { RepoData } from "@/lib/types"

/**
 * A Repo's run settings (label, scripts, port, env vars), edited in place on
 * the canvas so every collaborator's new Workspaces start from them. Opened by
 * Edit in Canvas settings and by Settings on the sidebar's repository row.
 * Saving changes this canvas only; given the `repository` it links to and
 * differs from, the footer offers Reset to Settings (#1424). Given
 * `onSaveToAll` too, an unchecked box saves the edit to that Repository and
 * every canvas using it instead (#1425). Env var values never pass through
 * the room doc: the Canvas Repo env module saves and reveals them on the
 * server and records their names there itself (#1492), and only
 * `canRevealEnv` (the Repo's adder) sees them (#1416).
 */
export function RepoSettingsDialog({
  roomId,
  canRevealEnv,
  repo,
  repository,
  open,
  onOpenChange,
  onUpdate,
  onSaveToAll,
}: {
  roomId: string
  /** Whether this person may reveal the Repo's stored env var values. */
  canRevealEnv: boolean
  repo: RepoData | null
  /** The Repository (Settings) this Repo follows, as the repository link
   *  policy answers it: one of yours, and never on hosted (#1427). */
  repository?: RepoConfig
  open: boolean
  onOpenChange: (open: boolean) => void
  onUpdate: (id: string, data: Partial<RepoData>) => void
  /** Save the edited `repository` to Settings and every canvas using it. */
  onSaveToAll?: (repository: RepoConfig) => Promise<void>
}) {
  return (
    <Dialog open={open && !!repo} onOpenChange={onOpenChange}>
      <DialogContent
        className={REPO_DIALOG_CONTENT}
        // Start in the name field without selecting it, as Settings' does.
        onOpenAutoFocus={(event) => {
          const name = (
            event.currentTarget as HTMLElement
          ).querySelector<HTMLInputElement>("#repo-settings-name")
          if (!name) return
          event.preventDefault()
          name.focus()
        }}
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
            roomId={roomId}
            canRevealEnv={canRevealEnv}
            repo={repo}
            repository={repository}
            onUpdate={onUpdate}
            onSaveToAll={onSaveToAll}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function RepoSettingsForm({
  roomId,
  canRevealEnv,
  repo,
  repository,
  onUpdate,
  onSaveToAll,
  onClose,
}: {
  roomId: string
  canRevealEnv: boolean
  repo: RepoData
  repository?: RepoConfig
  onUpdate: (id: string, data: Partial<RepoData>) => void
  onSaveToAll?: (repository: RepoConfig) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(repo.name ?? "")
  const [setupScript, setSetupScript] = useState(repo.setupScript)
  const [devScript, setDevScript] = useState(repo.devScript)
  const [devServerPort, setDevServerPort] = useState(
    String(repo.devServerPort ?? 3000)
  )
  const env = useCanvasRepoEnvField({
    roomId,
    repo,
    canReveal: canRevealEnv,
    onRevealError: () =>
      toast.error("Couldn't load the environment variables."),
  })
  const [copyPatterns, setCopyPatterns] = useState(repo.copyPatterns ?? "")
  const [defaultIframeLayerSizeId, setDefaultIframeLayerSizeId] = useState(
    repo.defaultIframeLayerSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID
  )
  const [systemPrompt, setSystemPrompt] = useState(repo.systemPrompt ?? "")
  const canSaveToAll = Boolean(repository && onSaveToAll)
  const [saveToAll, setSaveToAll] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedPort = Number.parseInt(devServerPort, 10)
  const portIsValid =
    Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort < 65536

  const trimmedSystemPrompt = systemPrompt.trim()

  const handleSave = useCallback(async () => {
    if (!portIsValid) return
    const settings = {
      name: name.trim(),
      setupScript,
      devScript,
      devServerPort: parsedPort,
      copyPatterns: copyPatterns.trim() ? copyPatterns : undefined,
      defaultIframeLayerSizeId,
      systemPrompt: trimmedSystemPrompt || undefined,
    }
    setSaving(true)
    setError(null)
    // Stored, then named in the doc, on the server (#1492).
    if (env.changed) {
      try {
        await saveCanvasRepoEnv(roomId, repo.id, env.text)
      } catch {
        setError("Couldn't save the environment variables.")
        setSaving(false)
        return
      }
    }
    if (saveToAll && repository && onSaveToAll) {
      try {
        await onSaveToAll({
          ...repository,
          ...settings,
          envVars: await env.valuesForAll(),
          updatedAt: Date.now(),
        })
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save. Try again.")
        setSaving(false)
        return
      }
    }
    // This canvas takes the edit itself as well, so it shows at once rather
    // than when the server's write syncs back.
    onUpdate(repo.id, settings)
    onClose()
  }, [
    portIsValid,
    name,
    setupScript,
    devScript,
    parsedPort,
    copyPatterns,
    defaultIframeLayerSizeId,
    trimmedSystemPrompt,
    env,
    roomId,
    repo.id,
    saveToAll,
    repository,
    onSaveToAll,
    onUpdate,
    onClose,
  ])

  // The values are stored before the doc claims them (#1476), as in Save: a
  // failed save leaves the Repo as it was and the dialog open.
  const resetToSettings = async (from: RepoConfig) => {
    setSaving(true)
    setError(null)
    try {
      await resetCanvasRepoEnv(roomId, repo.id, from.envVars)
    } catch {
      setError("Couldn't restore the environment variables.")
      setSaving(false)
      return
    }
    onUpdate(repo.id, repositorySettings(from))
    onClose()
  }

  const hasChanges =
    name.trim() !== (repo.name ?? "") ||
    setupScript !== repo.setupScript ||
    devScript !== repo.devScript ||
    parsedPort !== (repo.devServerPort ?? 3000) ||
    env.changed ||
    copyPatterns !== (repo.copyPatterns ?? "") ||
    defaultIframeLayerSizeId !==
      (repo.defaultIframeLayerSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID) ||
    trimmedSystemPrompt !== (repo.systemPrompt ?? "").trim()

  // Ticked, an unedited form can still save: it sends this canvas's
  // customized settings out to the rest.
  const differsFromRepository =
    repository !== undefined && isCustomized(repo, repository)
  const canSave =
    portIsValid &&
    !saving &&
    (hasChanges || (saveToAll && differsFromRepository))

  return (
    <>
      <RepoDialogHeader
        title="Edit repository"
        description="Defaults for new workspaces on this canvas."
        source={repo.repoFullName}
      />

      <RepoDialogBody>
        <Field>
          <FieldLabel htmlFor="repo-settings-name">Name</FieldLabel>
          <Input
            id="repo-settings-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={repo.repoFullName}
          />
          <FieldDescription>
            Optional. A short name like “web” or “api”, to tell apart two setups
            of one repository.
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
          envVars={env.value}
          onEnvVarsChange={env.onChange}
          envVarsAccess={env.access}
          copyPatterns={copyPatterns}
          onCopyPatternsChange={setCopyPatterns}
          defaultIframeLayerSizeId={defaultIframeLayerSizeId}
          onDefaultIframeLayerSizeIdChange={setDefaultIframeLayerSizeId}
          systemPrompt={systemPrompt}
          onSystemPromptChange={setSystemPrompt}
        />
      </RepoDialogBody>

      <RepoDialogFooter
        notice={
          (canSaveToAll || error) && (
            <>
              {canSaveToAll && (
                <Label
                  htmlFor="repo-settings-save-to-all"
                  className="font-normal"
                >
                  <Checkbox
                    id="repo-settings-save-to-all"
                    checked={saveToAll}
                    onCheckedChange={(checked) =>
                      setSaveToAll(checked === true)
                    }
                  />
                  Also update Settings and my other canvases
                </Label>
              )}
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </>
          )
        }
      >
        {repository && isCustomized(repo, repository) && (
          <Button
            variant="outline"
            className="sm:mr-auto"
            disabled={saving}
            onClick={() => void resetToSettings(repository)}
          >
            Reset to Settings
          </Button>
        )}
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={() => void handleSave()} disabled={!canSave}>
          {saving && <Spinner className="size-4" />}
          Save
        </Button>
      </RepoDialogFooter>
    </>
  )
}
