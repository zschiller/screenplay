"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowClockwiseIcon,
  CaretRightIcon,
} from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { Skeleton } from "@workspace/ui/components/skeleton"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  appInstructions,
  RepoAppPicker,
  suggestedApp,
} from "@/components/repo-app-picker"
import {
  RepoDialogBody,
  RepoDialogFooter,
} from "@/components/repo-dialog-layout"
import {
  RepoSettingsFields,
  runSettingsFieldProps,
} from "@/components/repo-settings-fields"
import {
  mergeDetectedSettings,
  type DetectableField,
  type DetectedApp,
  type DetectedSettings,
  type ResolvedRepoSettings,
} from "@/lib/add-repo/resolver"
import type { DetectRepoSettingsResult } from "@/lib/add-repo/actions"
import { DEFAULT_IFRAME_LAYER_SIZE_ID } from "@/lib/iframe-layer-sizes"
import { buildIdentity } from "@/lib/capabilities"
import {
  DEFAULT_DEV_SERVER_PORT,
  parseRunSettings,
  runSettingsFields,
  type RunSettingsFields,
} from "@/lib/run-settings"

/** Beyond this the modal gives up on detection and falls back to defaults. */
const DETECTION_TIMEOUT_MS = 8000
/** The model pass reads more and thinks longer; its server cap is 30s. */
const REFINE_TIMEOUT_MS = 35_000

/** Today's plain defaults, the model pass's first guess when rules found nothing. */
const PLAIN_DETECTED: DetectedSettings = {
  setupScript: "",
  devScript: "",
  devServerPort: DEFAULT_DEV_SERVER_PORT,
}

/**
 * `rules` is the first, rule-based pass: the form waits behind placeholders so
 * it appears once, already filled, instead of shifting under the cursor. The
 * model pass that follows (`detecting`) fills in place.
 */
const NO_NAMES: readonly string[] = []

type DetectionStatus = "idle" | "rules" | "detecting" | "done" | "failed"

/**
 * The confirm-and-configure add-modal body (PRD #673), rendered inside the
 * picker dialog's `settings` stage — same dialog shell, no second dialog. Its
 * fields scroll between the same hairlines as the edit dialogs
 * (`repo-dialog-layout`), with the buttons pinned under the lower one.
 *
 * It shows the *essential* run settings (setup script, run script, and — on
 * hosted — dev server port) always, plus an **Advanced** expander (#681) that
 * reveals the rest inline: default frame size, system prompt, and an optional
 * name. The env field sits in the essential group where a mechanism
 * exists; its presence is source-dependent (`showEnvField`) — a desktop
 * GitHub-clone has no injection path, so it hides the field entirely.
 *
 * The modal opens instantly with the essential fields editable and pre-filled
 * with today's plain defaults; if a `detect` seam is supplied (a GitHub-repo
 * pick), deterministic auto-detection (#678) kicks off as it opens and, when it
 * returns, fills only the fields the user hasn't touched. A `refine` seam then
 * has a model read the project's files and correct that first guess (a README
 * that runs `make dev`, a dev script pinned to another port, a monorepo's web
 * app), again only in untouched fields. Add is enabled once the form shows —
 * detection is an assist, never a gate.
 *
 * In a monorepo the rule-based pass lists every app, and an App field leads
 * the form. Picking an app fills its run script and port, and names the
 * Repository and its agent instructions after it, all only where untouched;
 * the model pass then refines the settings for that app.
 *
 * Confirm hands the resolved settings back, and the caller saves the
 * Repository (and, from a Canvas, switches it on there, #1423); Cancel adds
 * nothing.
 */
export function RepoAddSettings({
  detect,
  refine,
  showEnvField,
  existingNames = NO_NAMES,
  onAppChange,
  onConfirm,
  onCancel,
  cancelLabel = "Cancel",
}: {
  /**
   * Runs deterministic detection for the pick, or absent when no filesystem
   * source exists (nothing to detect against). The component owns the timeout
   * and the per-field merge; the caller only wires the source.
   */
  detect?: () => Promise<DetectRepoSettingsResult>
  /**
   * The model-assisted second pass, handed the first pass's result (or plain
   * defaults when it found nothing). Absent when there's no source to read.
   */
  refine?: (
    baseline: DetectedSettings,
    appPath?: string
  ) => Promise<DetectRepoSettingsResult>
  /**
   * Names of this repository's Repositories you already have. An app whose
   * name is among them reads "Added" in the App picker.
   */
  existingNames?: readonly string[]
  /** The app chosen in a monorepo, so the dialog can name it. */
  onAppChange?: (app: DetectedApp | undefined) => void
  /** Whether the source has an env-injection path — see `RepoSettingsFields`. */
  showEnvField: boolean
  onConfirm: (settings: ResolvedRepoSettings) => void
  onCancel: () => void
  /** "Back" when there is a previous screen to return to (#781). */
  cancelLabel?: string
}) {
  // The run settings live in one object so a detection fill can be applied
  // inside a single `setState` updater — against the live values, so it can't
  // race a keystroke (see mergeDetectedSettings). A desktop local-folder source
  // shows "files to copy" (not env vars) and pre-fills the checkout's
  // gitignored config globs (#682): `showEnvField` on the local build is
  // exactly a folder pick, since a desktop GitHub-clone passes
  // `showEnvField={false}`.
  const [fields, setFields] = useState<RunSettingsFields>(() => ({
    ...runSettingsFields(),
    copyPatterns: buildIdentity === "host" && showEnvField ? ".env*" : "",
  }))
  const [envVars, setEnvVars] = useState("")
  // The advanced section, revealed by the expander (#681).
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [presetName, setPresetName] = useState("")
  // Start in "rules" when there's a source to detect against, so the effect
  // never has to set that synchronously (and the placeholders are up on first
  // paint).
  const [status, setStatus] = useState<DetectionStatus>(
    detect ? "rules" : "idle"
  )
  // A monorepo's apps (two or more) and the one the settings are for.
  const [apps, setApps] = useState<DetectedApp[]>([])
  const [app, setApp] = useState<DetectedApp>()
  // The setup script the rules found: one per repository, whichever app.
  const rulesSetup = useRef(PLAIN_DETECTED.setupScript)

  // Which detectable fields the user has touched — a ref, not state, because
  // only the (async) merge reads it and it must never trigger a re-render.
  const dirty = useRef<Partial<Record<DetectableField, boolean>>>({})
  // Same for the two fields a chosen app names itself into.
  const nameDirty = useRef(false)
  const promptDirty = useRef(false)
  // Bumped per detection run so a stale result (a newer re-detect, or unmount)
  // can't apply over newer state.
  const runId = useRef(0)
  // The parent hands a fresh `detect` closure each render; hold the latest in a
  // ref so the kickoff effect can stay mount-once instead of re-firing on every
  // render (which would spam detection).
  const detectRef = useRef(detect)
  const refineRef = useRef(refine)
  const existingNamesRef = useRef(existingNames)
  const onAppChangeRef = useRef(onAppChange)
  useEffect(() => {
    detectRef.current = detect
    refineRef.current = refine
    existingNamesRef.current = existingNames
    onAppChangeRef.current = onAppChange
  })

  const setField = useCallback(
    (field: keyof RunSettingsFields) => (value: string) => {
      if (isDetectable(field)) dirty.current[field] = true
      if (field === "systemPrompt") promptDirty.current = true
      setFields((prev) => ({ ...prev, [field]: value }))
    },
    []
  )

  const changePresetName = useCallback((value: string) => {
    nameDirty.current = true
    setPresetName(value)
  }, [])

  /** Fill the form from an app, only where untouched. */
  const applyApp = useCallback((next: DetectedApp) => {
    setApp(next)
    onAppChangeRef.current?.(next)
    setFields((prev) => ({
      ...prev,
      ...mergeDetectedSettings(
        prev,
        settingsFor(next, rulesSetup.current),
        dirty.current
      ),
      systemPrompt: promptDirty.current
        ? prev.systemPrompt
        : appInstructions(next),
    }))
    if (!nameDirty.current) setPresetName(next.name)
  }, [])

  /** The model pass: refines the rule-based `baseline`, for `appPath` if any. */
  const runRefine = useCallback(
    async (
      currentRun: number,
      baseline: DetectedSettings,
      rulesOk: boolean,
      appPath?: string
    ) => {
      const refineRun = refineRef.current
      if (!refineRun) {
        setStatus(rulesOk ? "done" : "failed")
        return
      }
      setStatus("detecting")
      const refined = await withTimeout(
        refineRun(baseline, appPath),
        REFINE_TIMEOUT_MS
      )
      if (currentRun !== runId.current) return
      if (refined.ok) {
        setFields((prev) => ({
          ...prev,
          ...mergeDetectedSettings(prev, refined.settings, dirty.current),
        }))
      }
      setStatus(rulesOk || refined.ok ? "done" : "failed")
    },
    []
  )

  const runDetection = useCallback(async () => {
    const run = detectRef.current
    if (!run) return
    const currentRun = ++runId.current

    // Rules first: fast, and fills the form before the model reads.
    const result = await withTimeout(run(), DETECTION_TIMEOUT_MS)
    // A newer run (or an unmount) supersedes this one — drop the late result.
    if (currentRun !== runId.current) return
    let baseline = PLAIN_DETECTED
    let appPath: string | undefined
    if (result.ok) {
      rulesSetup.current = result.settings.setupScript
      const found = result.apps ?? []
      const chosen =
        found.length > 1
          ? suggestedApp(found, addedPaths(found, existingNamesRef.current))
          : undefined
      setFields((prev) => ({
        ...prev,
        ...mergeDetectedSettings(prev, result.settings, dirty.current),
      }))
      if (chosen) {
        setApps(found)
        applyApp(chosen)
        baseline = settingsFor(chosen, rulesSetup.current)
        appPath = chosen.path
      } else {
        baseline = result.settings
      }
    }
    await runRefine(currentRun, baseline, result.ok, appPath)
  }, [applyApp, runRefine])

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
    setStatus("rules")
    void runDetection()
  }, [runDetection])

  // Picking another app fills from it, then has the model look at that app.
  const chooseApp = useCallback(
    (next: DetectedApp) => {
      applyApp(next)
      void runRefine(
        ++runId.current,
        settingsFor(next, rulesSetup.current),
        true,
        next.path
      )
    },
    [applyApp, runRefine]
  )

  const added = useMemo(
    () => addedPaths(apps, existingNames),
    [apps, existingNames]
  )

  const settings = parseRunSettings(fields)

  const handleConfirm = useCallback(() => {
    if (!settings) return
    onConfirm({
      ...settings,
      envVars,
      // Only forward advanced values the user actually set: the default frame
      // size and an empty system prompt map to `undefined`, so the upsert
      // preserves whatever a matching Repository already carried (#681).
      defaultIframeLayerSizeId:
        settings.defaultIframeLayerSizeId === DEFAULT_IFRAME_LAYER_SIZE_ID
          ? undefined
          : settings.defaultIframeLayerSizeId,
      presetName: presetName.trim() || undefined,
    })
  }, [settings, envVars, presetName, onConfirm])

  if (status === "rules") {
    // Placeholders while the rules run (about a second), shaped like the form
    // so it lands without a jump.
    return (
      <>
        <DetectingLine />
        <RepoDialogBody>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </RepoDialogBody>
        <RepoDialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button disabled>Add repository</Button>
        </RepoDialogFooter>
      </>
    )
  }

  return (
    <>
      {status !== "idle" && status !== "done" && (
        <div className="flex min-h-5 items-center gap-2 px-5 pb-3 text-sm text-muted-foreground">
          {status === "detecting" ? (
            <DetectingContent />
          ) : (
            <>
              <span>Couldn’t auto-detect settings.</span>
              <Button
                variant="link"
                size="sm"
                className="h-auto gap-1 p-0 text-sm"
                onClick={reDetect}
              >
                <ArrowClockwiseIcon className="size-3" />
                Re-detect
              </Button>
            </>
          )}
        </div>
      )}
      <RepoDialogBody>
        {app && apps.length > 1 && (
          <RepoAppPicker
            id="repo-add-app"
            apps={apps}
            value={app}
            addedPaths={added}
            onChange={chooseApp}
          />
        )}
        <RepoSettingsFields
          idPrefix="repo-add"
          section="essential"
          showEnvField={showEnvField}
          // Advanced-only fields aren't rendered here; the shared component
          // still takes them, so it gets the real state (harmless when hidden).
          {...runSettingsFieldProps(fields, setField)}
          envVars={envVars}
          onEnvVarsChange={setEnvVars}
        />

        <Collapsible
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          className="group/advanced flex flex-col gap-5"
        >
          <CollapsibleTrigger className="flex items-center gap-1 self-start text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
            <CaretRightIcon className="size-4 transition-transform group-data-[state=open]/advanced:rotate-90" />
            Advanced
          </CollapsibleTrigger>
          <CollapsibleContent className="flex flex-col">
            <RepoSettingsFields
              idPrefix="repo-add"
              section="advanced"
              {...runSettingsFieldProps(fields, setField)}
              envVars={envVars}
              onEnvVarsChange={setEnvVars}
              presetName={presetName}
              onPresetNameChange={changePresetName}
            />
          </CollapsibleContent>
        </Collapsible>
      </RepoDialogBody>
      <RepoDialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button onClick={handleConfirm} disabled={!settings}>
          Add repository
        </Button>
      </RepoDialogFooter>
    </>
  )
}

function DetectingLine() {
  return (
    <div className="flex min-h-5 items-center gap-2 px-5 pb-3 text-sm text-muted-foreground">
      <DetectingContent />
    </div>
  )
}

function DetectingContent() {
  return (
    <>
      <Spinner className="size-3.5" />
      <span>Detecting settings…</span>
    </>
  )
}

/** An app's run settings, with the repository's one setup script. */
function settingsFor(app: DetectedApp, setupScript: string): DetectedSettings {
  return {
    setupScript,
    devScript: app.devScript,
    devServerPort: app.devServerPort,
  }
}

/** The apps already added: a Repository of this repository bears their name. */
function addedPaths(
  apps: DetectedApp[],
  existingNames: readonly string[]
): Set<string> {
  return new Set(
    apps.filter((a) => existingNames.includes(a.name)).map((a) => a.path)
  )
}

const DETECTABLE: readonly DetectableField[] = [
  "setupScript",
  "devScript",
  "devServerPort",
]

function isDetectable(field: string): field is DetectableField {
  return (DETECTABLE as readonly string[]).includes(field)
}

/** Race a detection call against a timeout; a throw or a timeout is `{ ok: false }`. */
async function withTimeout(
  call: Promise<DetectRepoSettingsResult>,
  ms: number
): Promise<DetectRepoSettingsResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<DetectRepoSettingsResult>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false }), ms)
  })
  try {
    return await Promise.race([call, timeout])
  } catch {
    return { ok: false }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
