"use client"

import { useCallback, useEffect, useReducer, useState } from "react"
import { Terminal } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
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
import { initialSetupState, setupReducer } from "@/lib/host-tool/setup-step"
import { HostSessionTerminal } from "@/components/agent/host-session-terminal"

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

  useEffect(() => {
    let cancelled = false
    listHarnessSetupRows().then((r) => {
      if (!cancelled) setRows(r)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!rows) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Checking coding agents…
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <HarnessSetupPanelRow key={row.hostBinary} initial={row} />
      ))}
    </div>
  )
}

function HarnessSetupPanelRow({ initial }: { initial: HarnessSetupRow }) {
  const [state, dispatch] = useReducer(setupReducer, initialSetupState)
  const [row, setRow] = useState<HarnessSetupRow>(initial)
  const [run, setRun] = useState<HarnessSetupRun | null>(null)
  const [preparing, setPreparing] = useState(false)

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
  const redetect = useCallback(async () => {
    const next = (await noteHarnessConnected()).find(
      (r) => r.hostBinary === initial.hostBinary
    )
    if (!next) return
    setRow(next)
    dispatch({ type: "detected", result: next.detection })
  }, [initial.hostBinary])

  // Start the row's action: resolve what it runs server-side (the descriptors'
  // command builders never ship to the client), then flip to `working`.
  const start = useCallback(
    async (kind: HarnessSetupActionKind) => {
      setPreparing(true)
      try {
        const plan = await resolveHarnessSetupRun(row.key, kind)
        if (!plan) return
        setRun(plan)
        dispatch({ type: "run-started" })
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
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{run.message}</p>
        <HostSessionTerminal
          sessionKey={`screenplay-harness-setup-${initial.hostBinary}`}
          command={run.command}
          onExit={() => {
            dispatch({ type: "terminal-exited" })
            redetect()
          }}
        />
      </div>
    )
  }

  const action = row.action

  return (
    <div className="flex items-center gap-3 rounded-lg border p-4">
      <Terminal className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              row.connected ? "bg-emerald-500" : "bg-muted-foreground/40"
            )}
            aria-hidden
          />
          <span className="text-sm font-medium">{row.label}</span>
        </div>
        <p className="text-sm text-muted-foreground">{row.detail}</p>
      </div>
      {action && (
        <Button
          type="button"
          size="sm"
          variant={action.primary ? "default" : "outline"}
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
