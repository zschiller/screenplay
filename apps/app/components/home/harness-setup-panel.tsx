"use client"

import { useCallback, useEffect, useReducer, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  listHarnessSetupRows,
  noteHarnessConnected,
  resolveHarnessSetupRun,
} from "@/lib/agent/harnesses/setup-actions"
import type {
  HarnessSetupActionKind,
  HarnessSetupRow,
  HarnessSetupRun,
} from "@/lib/agent/harnesses/setup"
import {
  setupRunError,
  setupStartError,
} from "@/lib/agent/harnesses/setup-error"
import { initialSetupState, setupReducer } from "@/lib/host-tool/setup-step"
import { HostSessionTerminal } from "@/components/agent/host-session-terminal"
import { HarnessModelsDialog } from "@/components/home/harness-models-dialog"
import { LoadErrorRow } from "@/components/home/load-error"
import { useHarnessModelChoices } from "@/lib/harness-model-choices"
import {
  SettingsRow,
  SettingsRowList,
  SettingsRowSkeleton,
} from "@/components/home/settings-row"

/**
 * The desktop "Coding agents" (Harness Setup) surface in Settings (ADR 0015),
 * the sibling of the GitHub Connection panel. It renders the rows the **Harness
 * Setup** module hands it (`lib/agent/harnesses/setup.ts`) — one per distinct host
 * binary, already carrying their detection result, state line, and the action to
 * offer — and drives each through the reusable host-tool setup step: the row's
 * action runs in a visible inline host-session terminal, and on PTY exit the row
 * re-probes **live** while the shared Harness Availability memo is busted, so a
 * freshly connected CLI reaches the model dropdown and new-tab picker without a
 * restart. No setup policy lives here: which action a row offers, how it reads,
 * and what it runs are all the module's answers. `isLocalBuild`-gated by its
 * caller.
 */
export function HarnessSetupPanel() {
  const [rows, setRows] = useState<HarnessSetupRow[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    listHarnessSetupRows()
      .then((r) => {
        if (!cancelled) setRows(r)
      })
      .catch((err) => {
        console.error("Failed to check coding agents", err)
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Retry after a failed check; a second failure rejects and leaves the error up.
  const recheck = useCallback(async () => {
    setRows(await listHarnessSetupRows())
    setLoadFailed(false)
  }, [])

  if (loadFailed) {
    return (
      <LoadErrorRow title="Couldn't check coding agents" onRetry={recheck} />
    )
  }

  if (!rows) {
    return <SettingsRowSkeleton label="Checking coding agents…" count={3} />
  }

  return (
    <SettingsRowList>
      {rows.map((row) => (
        <HarnessSetupPanelRow key={row.hostBinary} initial={row} />
      ))}
    </SettingsRowList>
  )
}

function HarnessSetupPanelRow({ initial }: { initial: HarnessSetupRow }) {
  const [state, dispatch] = useReducer(setupReducer, initialSetupState)
  const [row, setRow] = useState<HarnessSetupRow>(initial)
  const [run, setRun] = useState<HarnessSetupRun | null>(null)
  const [runKind, setRunKind] = useState<HarnessSetupActionKind | null>(null)
  const [preparing, setPreparing] = useState(false)
  // Why the last Install or Sign in didn't work, shown under the row.
  const [error, setError] = useState<string | null>(null)
  const [choosingModels, setChoosingModels] = useState(false)
  const chosenModels = useHarnessModelChoices()[row.key]?.length ?? 0

  // Seed the setup step from the row the parent already fetched, so it renders
  // its real state on first paint without a second round-trip.
  useEffect(() => {
    dispatch({ type: "detected", result: initial.detection })
    // Mount-once: `initial` is stable per hostBinary (the list key), and live
    // re-reads after a terminal run flow through `redetect`, not this seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A setup run finished: one call busts the availability memo and hands back
  // freshly probed rows; pick this row's out by its (stable) host binary.
  const redetect = useCallback(
    async (kind: HarnessSetupActionKind | null) => {
      let next: HarnessSetupRow | undefined
      try {
        next = (await noteHarnessConnected()).find(
          (r) => r.hostBinary === initial.hostBinary
        )
      } catch (err) {
        console.error("Failed to re-check coding agent", err)
      }
      if (kind) setError(setupRunError(kind, initial.label, next))
      if (!next) {
        // Leave `working` so the row's action is offered again.
        dispatch({ type: "detected", result: row.detection })
        return
      }
      setRow(next)
      dispatch({ type: "detected", result: next.detection })
    },
    [initial.hostBinary, initial.label, row.detection]
  )

  // Start the row's action: resolve what it runs server-side (the descriptors'
  // command builders never ship to the client), then flip to `working`.
  const start = useCallback(
    async (kind: HarnessSetupActionKind) => {
      setPreparing(true)
      setError(null)
      try {
        const plan = await resolveHarnessSetupRun(row.key, kind)
        if (!plan) {
          setError(setupStartError(kind))
          return
        }
        setRun(plan)
        setRunKind(kind)
        dispatch({ type: "run-started" })
      } catch (err) {
        console.error("Failed to start coding agent setup", err)
        setError(setupStartError(kind))
      } finally {
        setPreparing(false)
      }
    },
    [row.key]
  )

  // The setup terminal is live — show it in place of the status row until the
  // PTY exits, at which point we re-detect (and bust the availability memo).
  if (state.phase === "working" && run) {
    return (
      <div className="space-y-2 p-4">
        <p className="text-sm text-muted-foreground">{run.message}</p>
        <HostSessionTerminal
          sessionKey={`screenplay-harness-setup-${initial.hostBinary}`}
          command={run.command}
          onExit={() => {
            dispatch({ type: "terminal-exited" })
            void redetect(runKind)
          }}
        />
      </div>
    )
  }

  const action = row.action

  return (
    <>
      <SettingsRow
        title={row.label}
        state={row.state}
        status={row.connected ? "on" : "off"}
        detail={
          // A failed Install or Sign in says so in the facts line, where the
          // row already reads its details.
          error ? (
            <span role="alert" className="text-destructive">
              {error}
            </span>
          ) : (
            [
              row.version && `v${row.version}`,
              row.path,
              row.choosesModels &&
                chosenModels > 0 &&
                `${chosenModels} ${chosenModels === 1 ? "model" : "models"} in the model menu`,
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          )
        }
        action={
          (row.choosesModels || action) && (
            <div className="flex items-center gap-2">
              {row.choosesModels && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setChoosingModels(true)}
                >
                  Choose models
                </Button>
              )}
              {action && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={preparing}
                  onClick={() => start(action.kind)}
                >
                  {preparing && <Spinner className="size-4" />}
                  {action.label}
                </Button>
              )}
            </div>
          )
        }
      />
      {row.choosesModels && (
        <HarnessModelsDialog
          harnessKey={row.key}
          label={row.label}
          open={choosingModels}
          onOpenChange={setChoosingModels}
        />
      )}
    </>
  )
}
