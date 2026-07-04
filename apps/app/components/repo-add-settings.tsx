"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronRight, RotateCw } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Label } from "@workspace/ui/components/label"
import { Spinner } from "@workspace/ui/components/spinner"
import { RepoSettingsFields } from "@/components/repo-settings-fields"
import {
  mergeDetectedSettings,
  type DetectableField,
  type DetectableFields,
  type ResolvedRepoSettings,
} from "@/lib/add-repo/resolver"
import type { DetectRepoSettingsResult } from "@/lib/add-repo/actions"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"
import { isLocalBuild } from "@/lib/local-mode"

/** Beyond this the modal gives up on detection and falls back to defaults. */
const DETECTION_TIMEOUT_MS = 8000

type DetectionStatus = "idle" | "detecting" | "done" | "failed"

/**
 * The confirm-and-configure add-modal body (PRD #673), rendered inside the
 * picker dialog's `settings` stage — same dialog shell, no second dialog.
 *
 * It shows the *essential* run settings (setup script, run script, and — on
 * hosted — dev server port) always, plus an **Advanced** expander (#681) that
 * reveals the rest inline: default frame size, system prompt, and an optional
 * preset name. The env field sits in the essential group where a mechanism
 * exists; its presence is source-dependent (`showEnvField`) — a desktop
 * GitHub-clone has no injection path, so it hides the field entirely.
 *
 * The modal opens instantly with the essential fields editable and pre-filled
 * with today's plain defaults; if a `detect` seam is supplied (a GitHub-repo
 * pick), deterministic auto-detection (#678) kicks off as it opens and, when it
 * returns, fills only the fields the user hasn't touched. Add is enabled
 * throughout — detection is an assist, never a gate.
 *
 * Confirm hands the resolved settings back — along with whether to remember them
 * as a preset (PRD #680) — so the caller creates the Repo + first Branch and
 * kicks off provisioning; Cancel adds nothing.
 */
export function RepoAddSettings({
  detect,
  showEnvField,
  onConfirm,
  onCancel,
}: {
  /**
   * Runs deterministic detection for the pick, or absent when no filesystem
   * source exists (nothing to detect against). The component owns the timeout
   * and the per-field merge; the caller only wires the source.
   */
  detect?: () => Promise<DetectRepoSettingsResult>
  /** Whether the source has an env-injection path — see `RepoSettingsFields`. */
  showEnvField: boolean
  onConfirm: (
    settings: ResolvedRepoSettings,
    options: { savePreset: boolean }
  ) => void
  onCancel: () => void
}) {
  // The three detectable fields live in one object so a detection fill can be
  // applied inside a single `setState` updater — against the live values, so it
  // can't race a keystroke (see mergeDetectedSettings).
  const [fields, setFields] = useState<DetectableFields>({
    setupScript: "",
    devScript: "",
    devServerPort: "3000",
  })
  const [envVars, setEnvVars] = useState("")
  // A desktop local-folder source shows "files to copy" (not env vars) and
  // pre-fills the checkout's gitignored config globs (#682): `showEnvField` on
  // the local build is exactly a folder pick, since a desktop GitHub-clone
  // passes `showEnvField={false}`.
  const [copyPatterns, setCopyPatterns] = useState(
    isLocalBuild && showEnvField ? ".env*" : ""
  )
  // Advanced-section fields, revealed by the expander (#681).
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [defaultIframeLayerSizeId, setDefaultIframeLayerSizeId] = useState(
    DEFAULT_IFRAME_LAYER_SIZE_ID
  )
  const [systemPrompt, setSystemPrompt] = useState("")
  const [presetName, setPresetName] = useState("")
  // Remember these settings as a preset so re-adding the repo later is one
  // click. Default on; the save is best-effort and never blocks the add.
  const [savePreset, setSavePreset] = useState(true)
  // Start in "detecting" when there's a source to detect against, so the effect
  // never has to set that synchronously (and the indicator is up on first paint).
  const [status, setStatus] = useState<DetectionStatus>(
    detect ? "detecting" : "idle"
  )

  // Which detectable fields the user has touched — a ref, not state, because
  // only the (async) merge reads it and it must never trigger a re-render.
  const dirty = useRef<Partial<Record<DetectableField, boolean>>>({})
  // Bumped per detection run so a stale result (a newer re-detect, or unmount)
  // can't apply over newer state.
  const runId = useRef(0)
  // The parent hands a fresh `detect` closure each render; hold the latest in a
  // ref so the kickoff effect can stay mount-once instead of re-firing on every
  // render (which would spam detection).
  const detectRef = useRef(detect)
  useEffect(() => {
    detectRef.current = detect
  })

  const setField = useCallback((field: DetectableField, value: string) => {
    dirty.current[field] = true
    setFields((prev) => ({ ...prev, [field]: value }))
  }, [])

  const runDetection = useCallback(async () => {
    const run = detectRef.current
    if (!run) return
    const currentRun = ++runId.current

    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<DetectRepoSettingsResult>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false }), DETECTION_TIMEOUT_MS)
    })

    let result: DetectRepoSettingsResult
    try {
      result = await Promise.race([run(), timeout])
    } catch {
      result = { ok: false }
    } finally {
      if (timer) clearTimeout(timer)
    }

    // A newer run (or an unmount) supersedes this one — drop the late result.
    if (currentRun !== runId.current) return
    if (result.ok) {
      setFields((prev) =>
        mergeDetectedSettings(prev, result.settings, dirty.current)
      )
      setStatus("done")
    } else {
      setStatus("failed")
    }
  }, [])

  // Kick off detection once as the modal opens. All state writes happen after
  // the awaited result, never synchronously in the effect body.
  useEffect(() => {
    void runDetection()
    const invalidate = runId
    return () => {
      // Invalidate any in-flight run so its late result can't land post-unmount.
      invalidate.current++
    }
  }, [runDetection])

  const reDetect = useCallback(() => {
    setStatus("detecting")
    void runDetection()
  }, [runDetection])

  const parsedPort = Number.parseInt(fields.devServerPort, 10)
  const portIsValid =
    Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort < 65536

  const handleConfirm = useCallback(() => {
    if (!portIsValid) return
    onConfirm(
      {
        setupScript: fields.setupScript,
        devScript: fields.devScript,
        devServerPort: parsedPort,
        envVars,
        copyPatterns: copyPatterns.trim() ? copyPatterns : undefined,
        // Only forward advanced values the user actually set: the default frame
        // size and an empty system prompt map to `undefined`, so a preset upsert
        // preserves whatever the matched preset already carried (#681).
        defaultIframeLayerSizeId:
          defaultIframeLayerSizeId === DEFAULT_IFRAME_LAYER_SIZE_ID
            ? undefined
            : defaultIframeLayerSizeId,
        systemPrompt: systemPrompt.trim() || undefined,
        presetName: presetName.trim() || undefined,
      },
      { savePreset }
    )
  }, [
    portIsValid,
    parsedPort,
    fields,
    envVars,
    copyPatterns,
    defaultIframeLayerSizeId,
    systemPrompt,
    presetName,
    savePreset,
    onConfirm,
  ])

  return (
    <div className="flex flex-col gap-4 p-4 pt-0">
      {status !== "idle" && status !== "done" && (
        <div className="flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
          {status === "detecting" ? (
            <>
              <Spinner className="size-3.5" />
              <span>Detecting settings…</span>
            </>
          ) : (
            <>
              <span>Couldn&apos;t auto-detect settings.</span>
              <Button
                variant="link"
                size="sm"
                className="h-auto gap-1 p-0 text-xs"
                onClick={reDetect}
              >
                <RotateCw className="size-3" />
                Re-detect
              </Button>
            </>
          )}
        </div>
      )}
      <div className="-mx-4 flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-4">
        <RepoSettingsFields
          idPrefix="repo-add"
          section="essential"
          showEnvField={showEnvField}
          setupScript={fields.setupScript}
          onSetupScriptChange={(v) => setField("setupScript", v)}
          devScript={fields.devScript}
          onDevScriptChange={(v) => setField("devScript", v)}
          devServerPort={fields.devServerPort}
          onDevServerPortChange={(v) => setField("devServerPort", v)}
          envVars={envVars}
          onEnvVarsChange={setEnvVars}
          copyPatterns={copyPatterns}
          onCopyPatternsChange={setCopyPatterns}
          // Advanced-only fields aren't rendered here; the shared component still
          // requires them, so hand it the real state (harmless when hidden).
          defaultIframeLayerSizeId={defaultIframeLayerSizeId}
          onDefaultIframeLayerSizeIdChange={setDefaultIframeLayerSizeId}
          systemPrompt={systemPrompt}
          onSystemPromptChange={setSystemPrompt}
        />

        <Collapsible
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          className="group/advanced flex flex-col gap-4"
        >
          <CollapsibleTrigger className="flex items-center gap-1 self-start text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            <ChevronRight className="size-4 transition-transform group-data-[state=open]/advanced:rotate-90" />
            Advanced
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col">
            <RepoSettingsFields
              idPrefix="repo-add"
              section="advanced"
              setupScript={fields.setupScript}
              onSetupScriptChange={(v) => setField("setupScript", v)}
              devScript={fields.devScript}
              onDevScriptChange={(v) => setField("devScript", v)}
              devServerPort={fields.devServerPort}
              onDevServerPortChange={(v) => setField("devServerPort", v)}
              envVars={envVars}
              onEnvVarsChange={setEnvVars}
              copyPatterns={copyPatterns}
              onCopyPatternsChange={setCopyPatterns}
              defaultIframeLayerSizeId={defaultIframeLayerSizeId}
              onDefaultIframeLayerSizeIdChange={setDefaultIframeLayerSizeId}
              systemPrompt={systemPrompt}
              onSystemPromptChange={setSystemPrompt}
              presetName={presetName}
              onPresetNameChange={setPresetName}
            />
          </CollapsibleContent>
        </Collapsible>
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="repo-add-save-preset" className="font-normal">
          <Checkbox
            id="repo-add-save-preset"
            checked={savePreset}
            onCheckedChange={(checked) => setSavePreset(checked === true)}
          />
          Save these settings for next time
        </Label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={!portIsValid}>
            Add project
          </Button>
        </div>
      </div>
    </div>
  )
}
