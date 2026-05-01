"use client"

import { useState } from "react"
import { nanoid } from "nanoid"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { ScrollArea } from "@workspace/ui/components/scroll-area"
import { Textarea } from "@workspace/ui/components/textarea"
import { RepoPicker } from "@/components/repo-picker"
import { upsertWorkspaceConfig } from "@/lib/workspace-configs-actions"
import type { WorkspaceConfig } from "@/lib/workspace-configs.types"
import { ArtboardSizeSelect } from "@/components/artboard-size-select"
import { DEFAULT_ARTBOARD_SIZE_ID } from "@/lib/artboard-sizes"

interface WorkspaceConfigFormProps {
  initial?: WorkspaceConfig
  existingConfigs: WorkspaceConfig[]
  onSaved: (updated: WorkspaceConfig[]) => void
  onCancel: () => void
}

type RepoIdentity = Pick<
  WorkspaceConfig,
  "repoFullName" | "repoOwner" | "repoName" | "defaultBranch" | "cloneUrl" | "private"
>

export function WorkspaceConfigForm({
  initial,
  existingConfigs,
  onSaved,
  onCancel,
}: WorkspaceConfigFormProps) {
  const [repo, setRepo] = useState<RepoIdentity | null>(
    initial
      ? {
          repoFullName: initial.repoFullName,
          repoOwner: initial.repoOwner,
          repoName: initial.repoName,
          defaultBranch: initial.defaultBranch,
          cloneUrl: initial.cloneUrl,
          private: initial.private,
        }
      : null,
  )
  const [name, setName] = useState(initial?.name ?? "")
  const [setupScript, setSetupScript] = useState(initial?.setupScript ?? "")
  const [devScript, setDevScript] = useState(initial?.devScript ?? "")
  const [devServerPort, setDevServerPort] = useState(
    String(initial?.devServerPort ?? 3000),
  )
  const [envVars, setEnvVars] = useState(initial?.envVars ?? "")
  const [defaultArtboardSizeId, setDefaultArtboardSizeId] = useState(
    initial?.defaultArtboardSizeId ?? DEFAULT_ARTBOARD_SIZE_ID,
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
          c.name === trimmedName,
      ),
  )

  const canSave = Boolean(repo) && portIsValid && !nameCollision

  const handleSave = async () => {
    if (!repo || !canSave) return
    setSaving(true)
    setError(null)
    const now = Date.now()
    const config: WorkspaceConfig = {
      id: initial?.id ?? nanoid(),
      name: trimmedName,
      repoFullName: repo.repoFullName,
      repoOwner: repo.repoOwner,
      repoName: repo.repoName,
      defaultBranch: repo.defaultBranch,
      cloneUrl: repo.cloneUrl,
      private: repo.private,
      setupScript,
      devScript,
      devServerPort: parsedPort,
      envVars,
      defaultArtboardSizeId,
      systemPrompt: systemPrompt.trim() ? systemPrompt : undefined,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    }
    try {
      const updated = await upsertWorkspaceConfig(config)
      onSaved(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save")
      setSaving(false)
    }
  }

  if (!repo) {
    return (
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Choose a repository to configure.
        </p>
        <div className="rounded-lg border">
          <RepoPicker
            onSelect={(pick) => {
              if (pick.kind !== "repo") return
              setRepo({
                repoFullName: pick.repo.fullName,
                repoOwner: pick.repo.owner,
                repoName: pick.repo.name,
                defaultBranch: pick.repo.defaultBranch,
                cloneUrl: pick.repo.cloneUrl,
                private: pick.repo.private,
              })
            }}
          />
        </div>
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
        <div className="flex flex-col gap-3 pr-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="config-name">
              Configuration name{" "}
              <span className="font-normal text-muted-foreground/70">
                (optional, e.g. “web” or “api”)
              </span>
            </Label>
            <Input
              id="config-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="default"
            />
            {nameCollision && (
              <p className="text-xs text-destructive">
                A configuration named “{trimmedName || "default"}” already exists for this repo.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="config-setup">Setup script</Label>
            <Input
              id="config-setup"
              value={setupScript}
              onChange={(e) => setSetupScript(e.target.value)}
              placeholder="npm install"
              className="font-mono"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="config-dev">Dev script</Label>
            <Input
              id="config-dev"
              value={devScript}
              onChange={(e) => setDevScript(e.target.value)}
              placeholder="npm run dev"
              className="font-mono"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="config-port">Dev server port</Label>
            <Input
              id="config-port"
              type="number"
              min={1}
              max={65535}
              value={devServerPort}
              onChange={(e) => setDevServerPort(e.target.value)}
              placeholder="3000"
              className="font-mono"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="config-envvars">Environment variables</Label>
            <Textarea
              id="config-envvars"
              value={envVars}
              onChange={(e) => setEnvVars(e.target.value)}
              placeholder={"KEY=value\nANOTHER_KEY=value"}
              rows={4}
              className="max-w-full resize-y font-mono text-xs [field-sizing:fixed]"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="config-default-artboard-size">
              Default artboard size
            </Label>
            <ArtboardSizeSelect
              id="config-default-artboard-size"
              value={defaultArtboardSizeId}
              onChange={setDefaultArtboardSizeId}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="config-system-prompt">
              System prompt{" "}
              <span className="font-normal text-muted-foreground/70">
                (optional, appended to the agent&apos;s instructions — useful for monorepo context)
              </span>
            </Label>
            <Textarea
              id="config-system-prompt"
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="This config targets the Next.js app under apps/web. Treat apps/web as the project root."
              rows={4}
              className="max-w-full resize-y text-xs [field-sizing:fixed]"
            />
          </div>
        </div>
      </ScrollArea>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={!canSave || saving}>
          {saving ? "Saving…" : initial ? "Save changes" : "Create configuration"}
        </Button>
      </div>
    </div>
  )
}
