"use client"

import { useEffect, useState } from "react"
import { nanoid } from "nanoid"
import { FolderOpen } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { DialogFooter } from "@workspace/ui/components/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Spinner } from "@workspace/ui/components/spinner"
import { RepoPicker } from "@/components/repo-picker"
import { chooseLocalFolder, LocalFolderForm } from "@/components/local-folder"
import { RepoSettingsFields } from "@/components/repo-settings-fields"
import { upsertRepoConfig } from "@/lib/repo-configs-actions"
import type { RepoConfig } from "@/lib/repo-configs.types"
import type { NewRepoSource } from "@/lib/github-local/types"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"
import { isLocalBuild } from "@/lib/local-mode"

interface RepoConfigFormProps {
  /** The preset being edited; saving updates it in place. */
  initial?: RepoConfig
  /**
   * A preset to start a new one from (Duplicate, #784): its source and fields
   * seed the form, but saving creates a new preset.
   */
  template?: RepoConfig
  existingConfigs: RepoConfig[]
  /** Fires when the form starts or stops differing from what it opened with. */
  onDirtyChange?: (dirty: boolean) => void
  onSaved: (updated: RepoConfig[]) => void
  onCancel: () => void
}

type RepoIdentity = Pick<
  RepoConfig,
  | "repoFullName"
  | "repoOwner"
  | "repoName"
  | "defaultBranch"
  | "cloneUrl"
  | "localPath"
  | "private"
>

/**
 * The body of the preset editor dialog (the caller owns the `Dialog` and its
 * header): pick a source, then edit the preset's fields in the dialog's one
 * scroll area, with Cancel/Save pinned in the footer.
 */
export function RepoConfigForm({
  initial,
  template,
  existingConfigs,
  onDirtyChange,
  onSaved,
  onCancel,
}: RepoConfigFormProps) {
  const seed = initial ?? template
  const [repo, setRepo] = useState<RepoIdentity | null>(
    seed
      ? {
          repoFullName: seed.repoFullName,
          repoOwner: seed.repoOwner,
          repoName: seed.repoName,
          defaultBranch: seed.defaultBranch,
          cloneUrl: seed.cloneUrl,
          localPath: seed.localPath,
          private: seed.private,
        }
      : null
  )
  // Desktop folder-path fallback when the native directory dialog is
  // unreachable (story 27) — mirrors the in-Room add flow (#604).
  const [folderMode, setFolderMode] = useState(false)
  // A folder the native dialog picked but couldn't use, kept for the form.
  const [folderError, setFolderError] = useState<
    { path: string; error: string } | undefined
  >(undefined)
  const [name, setName] = useState(seed?.name ?? "")
  const [setupScript, setSetupScript] = useState(seed?.setupScript ?? "")
  const [devScript, setDevScript] = useState(seed?.devScript ?? "")
  const [devServerPort, setDevServerPort] = useState(
    String(seed?.devServerPort ?? 3000)
  )
  const [envVars, setEnvVars] = useState(seed?.envVars ?? "")
  const [copyPatterns, setCopyPatterns] = useState(
    seed ? (seed.copyPatterns ?? "") : ".env*"
  )
  const [defaultIframeLayerSizeId, setDefaultIframeLayerSizeId] = useState(
    seed?.defaultIframeLayerSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID
  )
  const [systemPrompt, setSystemPrompt] = useState(seed?.systemPrompt ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Everything Save would write, as one comparable value; the form is dirty
  // once it differs from the value it opened with, so Cancel can ask first.
  const snapshot = JSON.stringify([
    repo?.repoFullName,
    repo?.localPath,
    name,
    setupScript,
    devScript,
    devServerPort,
    envVars,
    copyPatterns,
    defaultIframeLayerSizeId,
    systemPrompt,
  ])
  const [openedWith] = useState(snapshot)
  const dirty = snapshot !== openedWith
  useEffect(() => {
    onDirtyChange?.(dirty)
  }, [dirty, onDirtyChange])

  const parsedPort = Number.parseInt(devServerPort, 10)
  const portIsValid =
    Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort < 65536

  const trimmedName = name.trim()
  const nameCollision = Boolean(
    repo &&
    existingConfigs.some(
      (c) =>
        c.id !== initial?.id &&
        c.repoFullName === repo.repoFullName &&
        c.name === trimmedName
    )
  )

  const canSave = Boolean(repo) && portIsValid && !nameCollision

  const handleSave = async () => {
    if (!repo || !canSave) return
    setSaving(true)
    setError(null)
    const now = Date.now()
    const config: RepoConfig = {
      id: initial?.id ?? nanoid(),
      name: trimmedName,
      repoFullName: repo.repoFullName,
      repoOwner: repo.repoOwner,
      repoName: repo.repoName,
      defaultBranch: repo.defaultBranch,
      cloneUrl: repo.cloneUrl,
      localPath: repo.localPath,
      private: repo.private,
      setupScript,
      devScript,
      devServerPort: parsedPort,
      envVars,
      copyPatterns: copyPatterns.trim() ? copyPatterns : undefined,
      defaultIframeLayerSizeId,
      systemPrompt: systemPrompt.trim() ? systemPrompt : undefined,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    }
    try {
      const updated = await upsertRepoConfig(config)
      onSaved(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save")
      setSaving(false)
    }
  }

  // Seed the preset's identity from a local-build source (a pasted clone URL or
  // a folder). Identity prefers the detected remote — `inspectLocalRepoPath`
  // already fills `repoFullName`/`cloneUrl` from a folder's `origin`, falling
  // back to the basename when remote-less (ADR 0013). We can't know visibility,
  // so `private` defaults to false (only the folder/lock icon reads it). The
  // `localPath` rides along: the remote names the preset, the path opens it.
  const applySource = (source: NewRepoSource) => {
    setRepo({
      repoFullName: source.repoFullName,
      repoOwner: source.repoOwner,
      repoName: source.repoName,
      defaultBranch: source.defaultBranch,
      cloneUrl: source.cloneUrl,
      localPath: source.localPath,
      private: false,
    })
    setFolderMode(false)
  }

  // "Open a folder" fires the native OS directory dialog directly; only when no
  // native picker is reachable (sidecar driven from a browser) do we fall back
  // to the path-input form (#604).
  const openFolder = async () => {
    const result = await chooseLocalFolder()
    if (result.kind === "source") applySource(result.source)
    else if (result.kind === "error") {
      setFolderError({ path: result.path, error: result.error })
      setFolderMode(true)
    } else if (result.kind === "fallback") {
      setFolderError(undefined)
      setFolderMode(true)
    }
  }

  if (!repo) {
    return (
      <>
        <div className="flex min-w-0 flex-col gap-3 px-4 pb-4">
          <p className="text-sm text-muted-foreground">
            Choose a git repository for this preset.
          </p>
          {folderMode ? (
            <div className="rounded-lg border">
              <LocalFolderForm
                initial={folderError}
                onBack={() => setFolderMode(false)}
                onResolved={applySource}
              />
            </div>
          ) : (
            <>
              <div className="rounded-lg border">
                <RepoPicker
                  // Same sources as the canvas add flow: a GitHub pick, or — on
                  // the local build — a pasted clone URL folded into the search
                  // box (#605). Folder sources come through the button below
                  // (#604/#606), not the picker itself.
                  localSources={isLocalBuild}
                  onSelect={(pick) => {
                    if (pick.kind === "repo") {
                      setRepo({
                        repoFullName: pick.repo.fullName,
                        repoOwner: pick.repo.owner,
                        repoName: pick.repo.name,
                        defaultBranch: pick.repo.defaultBranch,
                        cloneUrl: pick.repo.cloneUrl,
                        private: pick.repo.private,
                      })
                    } else if (pick.kind === "source") {
                      // A pasted clone URL. The picker here lists no saved
                      // configs, so `kind: "config"` never occurs.
                      applySource(pick.source)
                    }
                  }}
                />
              </div>
              {isLocalBuild && (
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-start gap-2 font-normal"
                  onClick={openFolder}
                >
                  <FolderOpen className="size-4 text-muted-foreground" />
                  Open a folder
                </Button>
              )}
            </>
          )}
        </div>
        <DialogFooter className="mx-0 mb-0">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </>
    )
  }

  return (
    <>
      <div className="flex min-w-0 items-center justify-between gap-2 px-4 pb-3">
        <div className="min-w-0 truncate text-sm">
          <span className="text-muted-foreground">Source </span>
          <span className="font-mono">{repo.repoFullName}</span>
        </div>
        {!initial && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs"
            onClick={() => setRepo(null)}
          >
            Change
          </Button>
        )}
      </div>

      {/* The dialog's only scroll. The max-height must land on the Radix
          viewport itself — shadcn hardcodes h-full on it, so a max-h on the
          outer ScrollArea never creates a scroll boundary (shadcn #296). */}
      <ScrollArea
        orientation="vertical"
        className="border-t [&>[data-slot=scroll-area-viewport]]:max-h-[60vh]"
      >
        <div className="flex flex-col gap-5 p-4">
          <Field>
            <FieldLabel htmlFor="config-name">Preset name</FieldLabel>
            <Input
              id="config-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="default"
            />
            <FieldDescription>Optional, e.g. “web” or “api”.</FieldDescription>
            {nameCollision && (
              <FieldError>
                A preset named “{trimmedName || "default"}” already exists for
                this source.
              </FieldError>
            )}
          </Field>

          <RepoSettingsFields
            idPrefix="config"
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
      </ScrollArea>

      {error && (
        <p role="alert" className="px-4 pb-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter className="mx-0 mb-0">
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!canSave || saving}>
          {saving && <Spinner className="size-4" />}
          {initial ? "Save changes" : "Create preset"}
        </Button>
      </DialogFooter>
    </>
  )
}
