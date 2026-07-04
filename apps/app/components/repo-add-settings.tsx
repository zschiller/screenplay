"use client"

import { useCallback, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { RepoSettingsFields } from "@/components/repo-settings-fields"
import type { ResolvedRepoSettings } from "@/lib/add-repo/resolver"

/**
 * The confirm-and-configure add-modal body (PRD #673, spine slice #676),
 * rendered inside the picker dialog's `settings` stage — same dialog shell, no
 * second dialog or portal.
 *
 * It shows the *essential* run settings (setup script, run script, and — on
 * hosted — dev server port), pre-filled with today's plain defaults (empty
 * scripts, port 3000) and fully editable. Confirm hands the resolved settings
 * back so the caller creates the Repo + first Branch and kicks off
 * provisioning; Cancel adds nothing. Auto-detection and the advanced-fields
 * expander land in later slices.
 */
export function RepoAddSettings({
  onConfirm,
  onCancel,
}: {
  onConfirm: (settings: ResolvedRepoSettings) => void
  onCancel: () => void
}) {
  const [setupScript, setSetupScript] = useState("")
  const [devScript, setDevScript] = useState("")
  const [devServerPort, setDevServerPort] = useState("3000")
  const [envVars, setEnvVars] = useState("")
  const [copyPatterns, setCopyPatterns] = useState("")

  const parsedPort = Number.parseInt(devServerPort, 10)
  const portIsValid =
    Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort < 65536

  const handleConfirm = useCallback(() => {
    if (!portIsValid) return
    onConfirm({
      setupScript,
      devScript,
      devServerPort: parsedPort,
      envVars,
      copyPatterns: copyPatterns.trim() ? copyPatterns : undefined,
    })
  }, [
    portIsValid,
    parsedPort,
    setupScript,
    devScript,
    envVars,
    copyPatterns,
    onConfirm,
  ])

  return (
    <div className="flex flex-col gap-4 p-4 pt-0">
      <div className="-mx-4 max-h-[60vh] overflow-y-auto px-4">
        <RepoSettingsFields
          idPrefix="repo-add"
          section="essential"
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
          // The advanced fields aren't rendered in the essential section, so
          // these are inert placeholders satisfying the shared component's API.
          defaultIframeLayerSizeId=""
          onDefaultIframeLayerSizeIdChange={() => {}}
          systemPrompt=""
          onSystemPromptChange={() => {}}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleConfirm} disabled={!portIsValid}>
          Add project
        </Button>
      </div>
    </div>
  )
}
