"use client"

import { useState } from "react"
import { nanoid } from "nanoid"
import { FolderOpen } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { RepoPicker } from "@/components/repo-picker"
import { chooseLocalFolder, LocalFolderForm } from "@/components/local-folder"
import { RepoSettingsFields } from "@/components/repo-settings-fields"
import { upsertRepoConfig } from "@/lib/repo-configs-actions"
import type { RepoConfig } from "@/lib/repo-configs.types"
import type { NewRepoSource } from "@/lib/github-local/types"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"
import { isLocalBuild } from "@/lib/local-mode"

interface RepoConfigFormProps {
  initial?: RepoConfig
  existingConfigs: RepoConfig[]
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

export function RepoConfigForm({
  initial,
  existingConfigs,
  onSaved,
  onCancel,
}: RepoConfigFormProps) {
  const [repo, setRepo] = useState<RepoIdentity | null>(
    initial
      ? {
          repoFullName: initial.repoFullName,
          repoOwner: initial.repoOwner,
          repoName: initial.repoName,
          defaultBranch: initial.defaultBranch,
          cloneUrl: initial.cloneUrl,
          localPath: initial.localPath,
          private: initial.private,
        }
      : null
  )
  // Desktop folder-path fallback when the native directory dialog is
  // unreachable (story 27) — mirrors the in-Room add flow (#604).
  const [folderMode, setFolderMode] = useState(false)
  const [name, setName] = useState(initial?.name ?? "")
  const [setupScript, setSetupScript] = useState(initial?.setupScript ?? "")
  const [devScript, setDevScript] = useState(initial?.devScript ?? "")
  const [devServerPort, setDevServerPort] = useState(
    String(initial?.devServerPort ?? 3000)
  )
  const [envVars, setEnvVars] = useState(initial?.envVars ?? "")
  const [copyPatterns, setCopyPatterns] = useState(
    initial ? (initial.copyPatterns ?? "") : ".env*"
  )
  const [defaultIframeLayerSizeId, setDefaultIframeLayerSizeId] = useState(
    initial?.defaultIframeLayerSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID
  )
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    else if (result.kind === "fallback") setFolderMode(true)
  }

  if (!repo) {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Choose a repository for this preset.
        </p>
        {folderMode ? (
          <div className="rounded-lg border">
            <LocalFolderForm
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
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0 truncate text-sm">
          <span className="text-muted-foreground">Repo </span>
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

      <ScrollArea className="max-h-[60vh]">
        <div className="flex flex-col gap-5 pr-3">
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
                this repo.
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

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={!canSave || saving}>
          {saving ? "Saving…" : initial ? "Save changes" : "Create preset"}
        </Button>
      </div>
    </div>
  )
}
