"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
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
import { Label } from "@workspace/ui/components/label"
import { RepoSettingsFields } from "@/components/repo-settings-fields"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { revealCanvasRepoEnv, saveCanvasRepoEnv } from "@/lib/repo-env/actions"
import {
  envVarNames,
  mergeEnvVars,
  repoEnvVarNames,
} from "@/lib/repo-env/names"
import { isCustomized, runSettings } from "@/lib/repository-library"
import type { RepoData } from "@/lib/types"

/**
 * A Repo's run settings (label, scripts, port, env vars), edited in place on
 * the canvas so every collaborator's new Workspaces start from them. Opened by
 * Edit in Canvas settings and by Settings on the sidebar's repository row.
 * Saving changes this canvas only; given the `repository` it links to and
 * differs from, the footer offers Reset to Settings (#1424). Given
 * `onSaveToAll` too, an unchecked box saves the edit to that Repository and
 * every canvas using it instead (#1425). Env var values never pass through
 * the room doc: they're saved and revealed through server actions, and only
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
  // The values live on the server (#1416). The adder's field stays locked
  // until they reveal it, then saves back whole; anyone else starts empty, and
  // the lines they type replace just those variables.
  const hasStoredEnv = repoEnvVarNames(repo).length > 0
  const [envVars, setEnvVars] = useState("")
  const [loadedEnv, setLoadedEnv] = useState<string | null>(null)
  const [revealing, setRevealing] = useState(false)
  const [hidden, setHidden] = useState(true)
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

  // The adder's stored values can be shown and hidden again; hiding keeps
  // any edit, it only masks the field.
  const envHideable = canRevealEnv && hasStoredEnv
  const envLocked = envHideable && (loadedEnv === null || hidden)
  const envChanged =
    loadedEnv !== null ? envVars !== loadedEnv : !envLocked && envVars !== ""

  const reveal = () => {
    if (loadedEnv !== null) {
      setHidden(false)
      return
    }
    setRevealing(true)
    revealCanvasRepoEnv(roomId, repo.id)
      .then((text) => {
        setLoadedEnv(text)
        setEnvVars(text)
        setHidden(false)
      })
      .catch(() => toast.error("Couldn't load the environment variables."))
      .finally(() => setRevealing(false))
  }

  // The values Save to all sends: this canvas's, as far as this form knows
  // them. Only the adder can read the stored ones; anyone else's typed lines
  // go over the Repository's own.
  const envForAll = useCallback(
    async (from: RepoConfig): Promise<string> => {
      if (canRevealEnv) {
        if (envChanged || loadedEnv !== null) return envVars
        if (hasStoredEnv) return revealCanvasRepoEnv(roomId, repo.id)
        return ""
      }
      return envChanged ? mergeEnvVars(from.envVars, envVars) : from.envVars
    },
    [
      canRevealEnv,
      envChanged,
      envVars,
      hasStoredEnv,
      loadedEnv,
      roomId,
      repo.id,
    ]
  )

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
    const patch: Partial<RepoData> = { ...settings }
    setSaving(true)
    setError(null)
    if (envChanged) {
      try {
        const fields = await saveCanvasRepoEnv(
          roomId,
          repo.id,
          envVars,
          canRevealEnv ? "replace" : "merge"
        )
        Object.assign(patch, fields, { envVars: undefined })
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
          envVars: await envForAll(repository),
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
    onUpdate(repo.id, patch)
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
    envChanged,
    roomId,
    repo.id,
    envVars,
    canRevealEnv,
    saveToAll,
    repository,
    onSaveToAll,
    envForAll,
    onUpdate,
    onClose,
  ])

  // The values are stored before the doc claims them (#1476), as in Save: a
  // failed save leaves the Repo as it was and the dialog open.
  const resetToSettings = async (from: RepoConfig) => {
    setSaving(true)
    setError(null)
    let fields
    try {
      fields = await saveCanvasRepoEnv(roomId, repo.id, from.envVars, "replace")
    } catch {
      setError("Couldn't restore the environment variables.")
      setSaving(false)
      return
    }
    onUpdate(repo.id, {
      name: from.name,
      ...runSettings(from),
      ...fields,
      envVars: undefined,
    })
    onClose()
  }

  const hasChanges =
    name.trim() !== (repo.name ?? "") ||
    setupScript !== repo.setupScript ||
    devScript !== repo.devScript ||
    parsedPort !== (repo.devServerPort ?? 3000) ||
    envChanged ||
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
      <DialogHeader>
        <DialogTitle>Repository settings</DialogTitle>
        <DialogDescription>
          Defaults for new workspaces of {repo.repoFullName} on this canvas.
        </DialogDescription>
      </DialogHeader>

      <div className="-mx-5 flex max-h-[60vh] flex-col gap-5 overflow-y-auto px-5">
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
          envVars={envLocked ? "" : envVars}
          onEnvVarsChange={setEnvVars}
          envVarsAccess={{
            names:
              loadedEnv !== null ? envVarNames(envVars) : repoEnvVarNames(repo),
            owned: canRevealEnv,
            hideable: envHideable,
            locked: envLocked,
            revealing,
            onReveal: reveal,
            onHide: () => setHidden(true),
          }}
          copyPatterns={copyPatterns}
          onCopyPatternsChange={setCopyPatterns}
          defaultIframeLayerSizeId={defaultIframeLayerSizeId}
          onDefaultIframeLayerSizeIdChange={setDefaultIframeLayerSizeId}
          systemPrompt={systemPrompt}
          onSystemPromptChange={setSystemPrompt}
        />
      </div>

      {canSaveToAll && (
        <Label htmlFor="repo-settings-save-to-all" className="font-normal">
          <Checkbox
            id="repo-settings-save-to-all"
            checked={saveToAll}
            onCheckedChange={(checked) => setSaveToAll(checked === true)}
          />
          Also update Settings and my other canvases
        </Label>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        {repository && isCustomized(repo, repository) && (
          <Button
            variant="outline"
            size="sm"
            className="sm:mr-auto"
            disabled={saving}
            onClick={() => void resetToSettings(repository)}
          >
            Reset to Settings
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void handleSave()} disabled={!canSave}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  )
}
