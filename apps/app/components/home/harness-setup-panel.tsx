"use client"

import { useCallback, useEffect, useReducer, useState } from "react"
import { Terminal } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import {
  listHarnessSetupStatus,
  noteHarnessConnected,
  resolveHarnessSetupCommands,
} from "@/lib/agent/harnesses/setup-actions"
import type { HarnessSetupStatus } from "@/lib/agent/harnesses/setup-status"
import {
  initialSetupState,
  setupReducer,
  type DetectionResult,
} from "@/lib/host-tool/setup-step"
import { HostSessionTerminal } from "@/components/agent/host-session-terminal"

/**
 * The desktop "Coding agents" (Harness Setup) surface in Settings (ADR 0015),
 * the sibling of the GitHub Connection panel. It lists the installable coding
 * CLIs **one row per distinct host binary** — the dedupe fold that collapses the
 * two opencode slots to a single row — and drives each through the reusable
 * host-tool setup step: from not-installed, one button installs the CLI and
 * chains straight into its own sign-in in a visible inline host-session terminal;
 * a signed-out CLI just signs in; a connected one offers only a secondary
 * re-run. On PTY exit the row re-detects **live** and busts the shared Harness
 * Availability memo, so a freshly connected CLI reaches the model dropdown and
 * new-tab picker without a restart. `isLocalBuild`-gated by its caller.
 */
export function HarnessSetupPanel() {
  const [rows, setRows] = useState<HarnessSetupStatus[] | null>(null)

  useEffect(() => {
    let cancelled = false
    listHarnessSetupStatus().then((r) => {
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
        <HarnessSetupRow key={row.hostBinary} initial={row} />
      ))}
    </div>
  )
}

/** What the working terminal runs — install-then-sign-in, or a bare sign-in —
 *  so the row can label it and mount the matching command. */
interface RunPlan {
  command: string[]
  message: string
}

function HarnessSetupRow({ initial }: { initial: HarnessSetupStatus }) {
  const [state, dispatch] = useReducer(setupReducer, initialSetupState)
  const [status, setStatus] = useState<HarnessSetupStatus>(initial)
  const [run, setRun] = useState<RunPlan | null>(null)
  const [preparing, setPreparing] = useState(false)

  // Seed the setup step from the status the parent already fetched, so the row
  // renders its real state on first paint without a second round-trip.
  useEffect(() => {
    dispatch({ type: "detected", result: detectionResult(initial) })
    // Mount-once: `initial` is stable per hostBinary (the list key), and live
    // re-reads after a terminal run flow through `redetect`, not this seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live re-read after a setup run: read a fresh status (never the launch-
  // memoized resolver), fold it back into the step, and default to
  // not-installed if this binary dropped off the list entirely.
  const redetect = useCallback(async () => {
    const list = await listHarnessSetupStatus()
    const next =
      list.find((r) => r.hostBinary === initial.hostBinary) ??
      ({
        ...initial,
        installed: false,
        authenticated: null,
      } as HarnessSetupStatus)
    setStatus(next)
    dispatch({ type: "detected", result: detectionResult(next) })
  }, [initial])

  // Start a terminal action: resolve its argv server-side (the descriptor's
  // command builders never ship to the client), remember its command/label, then
  // flip to `working`.
  const start = useCallback(
    async (kind: SetupActionKind) => {
      setPreparing(true)
      try {
        const cmds = await resolveHarnessSetupCommands(status.key)
        if (!cmds) return
        const command =
          kind === "install"
            ? (cmds.installAndAuth ?? cmds.authOnly)
            : cmds.authOnly
        setRun({ command, message: runMessage(kind, status.label) })
        dispatch({ type: "run-started" })
      } finally {
        setPreparing(false)
      }
    },
    [status.key, status.label]
  )

  // The setup terminal is live — show it in place of the status row until the
  // PTY exits, at which point we bust the availability memo (so the dropdown /
  // picker re-probe) and re-detect live.
  if (state.phase === "working" && run) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{run.message}</p>
        <HostSessionTerminal
          sessionKey={`screenplay-harness-setup-${initial.hostBinary}`}
          command={run.command}
          onExit={() => {
            dispatch({ type: "terminal-exited" })
            noteHarnessConnected().then(redetect)
          }}
        />
      </div>
    )
  }

  const view = describeRow(status)
  const action = setupAction(status)

  return (
    <div className="flex items-center gap-3 rounded-lg border p-4">
      <Terminal className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              view.connected ? "bg-emerald-500" : "bg-muted-foreground/40"
            )}
            aria-hidden
          />
          <span className="text-sm font-medium">{status.label}</span>
        </div>
        <p className="text-sm text-muted-foreground">{view.detail}</p>
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

/** A setup terminal action: install the CLI (then chain into sign-in), or just
 *  sign in an already-installed CLI. */
type SetupActionKind = "install" | "auth"

/** The status message shown above the working terminal. */
function runMessage(kind: SetupActionKind, label: string): string {
  if (kind === "install") {
    return (
      `Installing ${label}, then signing you in — follow the prompts below. ` +
      "Once sign-in finishes, this closes and the row updates automatically."
    )
  }
  return (
    `Signing in to ${label} — follow the prompts below. Once sign-in ` +
    "finishes, this closes and the row updates automatically."
  )
}

/**
 * Map a live setup status to the reusable step's detection result — exactly as
 * the `gh` panel's `detectionResult()` does. Honest degradation: an unknown auth
 * fact (`authenticated === null`, e.g. an indeterminate probe) reads as
 * *installed but signed out* so the row offers a sign-in, never a false
 * "connected".
 */
function detectionResult(status: HarnessSetupStatus): DetectionResult {
  if (!status.installed) return "not-installed"
  return status.authenticated === true ? "authed" : "installed-not-authed"
}

/**
 * The row's setup affordance. Help is one-directional (ADR 0015): not-installed
 * gets a primary **Install & sign in** (install chained into the CLI's own
 * sign-in); signed-out gets a primary **Sign in**; connected gets only a
 * secondary **Re-run sign-in** to refresh a lapsed login. No sign-out, no
 * uninstall — ever.
 */
function setupAction(
  status: HarnessSetupStatus
): { kind: SetupActionKind; label: string; primary: boolean } | null {
  if (!status.installed) {
    return { kind: "install", label: "Install & sign in", primary: true }
  }
  if (status.authenticated === true) {
    return { kind: "auth", label: "Re-run sign-in", primary: false }
  }
  return { kind: "auth", label: "Sign in", primary: true }
}

/** Turn the live status into the row's connection dot + state line. */
function describeRow(status: HarnessSetupStatus): {
  connected: boolean
  detail: string
} {
  if (!status.installed) {
    return {
      connected: false,
      detail: `${status.label} isn't installed yet — install it to use it here.`,
    }
  }
  if (status.authenticated === true) {
    return {
      connected: true,
      detail: `Connected — signed in to ${status.label}.`,
    }
  }
  return {
    connected: false,
    detail: `${status.label} is installed but not signed in.`,
  }
}
