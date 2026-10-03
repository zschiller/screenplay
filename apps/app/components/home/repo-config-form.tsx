"use client"

import { useEffect, useState } from "react"
import { nanoid } from "nanoid"
import { Button } from "@workspace/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field"
import { Input } from "@workspace/ui/components/input"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  RepoDialogBody,
  RepoDialogFooter,
} from "@/components/repo-dialog-layout"
import { RepoSettingsFields } from "@/components/repo-settings-fields"
import { saveRepository } from "@/lib/repository-library/actions"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"

interface RepoConfigFormProps {
  /** The Repository being edited; saving updates it in place. */
  initial?: RepoConfig
  /**
   * A Repository to start a new one from (Duplicate, #784): its source and
   * fields seed the form, but saving creates a new one. One of `initial` or
   * `template` is required; New repository goes through the add flow (#1423).
   */
  template?: RepoConfig
  existingConfigs: RepoConfig[]
  /** Fires when the form starts or stops differing from what it opened with. */
  onDirtyChange?: (dirty: boolean) => void
  onSaved: (updated: RepoConfig[]) => void
  onCancel: () => void
}

/**
 * The body of the Repository editor dialog (the caller owns the `Dialog` and
 * its {@link RepoDialogHeader}): edit an existing Repository's fields, or a
 * duplicate's, in the dialog's one scroll area, with Cancel/Save pinned in the
 * footer.
 */
export function RepoConfigForm({
  initial,
  template,
  existingConfigs,
  onDirtyChange,
  onSaved,
  onCancel,
}: RepoConfigFormProps) {
  const seed = (initial ?? template)!
  const repo = seed
  const [name, setName] = useState(seed.name ?? "")
  const [setupScript, setSetupScript] = useState(seed.setupScript ?? "")
  const [devScript, setDevScript] = useState(seed.devScript ?? "")
  const [devServerPort, setDevServerPort] = useState(
    String(seed.devServerPort ?? 3000)
  )
  const [envVars, setEnvVars] = useState(seed.envVars ?? "")
  const [copyPatterns, setCopyPatterns] = useState(seed.copyPatterns ?? "")
  const [defaultIframeLayerSizeId, setDefaultIframeLayerSizeId] = useState(
    seed.defaultIframeLayerSizeId ?? DEFAULT_IFRAME_LAYER_SIZE_ID
  )
  const [systemPrompt, setSystemPrompt] = useState(seed.systemPrompt ?? "")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Everything Save would write, as one comparable value; the form is dirty
  // once it differs from the value it opened with, so Cancel can ask first.
  const snapshot = JSON.stringify([
    repo.repoFullName,
    repo.localPath,
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
  const nameCollision = existingConfigs.some(
    (c) =>
      c.id !== initial?.id &&
      c.repoFullName === repo.repoFullName &&
      c.name === trimmedName
  )

  const canSave = portIsValid && !nameCollision

  const handleSave = async () => {
    if (!canSave) return
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
      systemPrompt: systemPrompt.trim() || undefined,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    }
    try {
      const updated = await saveRepository(config)
      onSaved(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save. Try again.")
      setSaving(false)
    }
  }

  return (
    <>
      <RepoDialogBody>
        <Field>
          <FieldLabel htmlFor="config-name">Name</FieldLabel>
          <Input
            id="config-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <FieldDescription>
            Optional. A short name like “web” or “api”, to tell apart two setups
            of one repository.
          </FieldDescription>
          {nameCollision && (
            <FieldError>
              {trimmedName
                ? `A repository named “${trimmedName}” is already set up from this source.`
                : "This source is already set up without a name. Give this one a name."}
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
      </RepoDialogBody>

      <RepoDialogFooter
        notice={
          error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )
        }
      >
        <Button variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={!canSave || saving}>
          {saving && <Spinner className="size-4" />}
          {initial ? "Save" : "Create repository"}
        </Button>
      </RepoDialogFooter>
    </>
  )
}
