"use client"

import { useCallback, useEffect, useReducer, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import {
  getGitHubLocalStatus,
  type GitHubLocalStatus,
} from "@/lib/github-local/actions"
import { buildGhAuthLoginArgv } from "@/lib/host-tool/gh-auth-command"
import { buildGhInstallAndAuthArgv } from "@/lib/host-tool/gh-install-command"
import { probeHomebrewPresent } from "@/lib/host-tool/install-actions"
import {
  initialSetupState,
  setupReducer,
  type DetectionResult,
} from "@/lib/host-tool/setup-step"
import { HostSessionTerminal } from "@/components/agent/host-session-terminal"
import { LoadErrorRow } from "@/components/home/load-error"
import {
  SettingsRow,
  SettingsRowList,
  SettingsRowSkeleton,
} from "@/components/home/settings-row"

/** Stable PTY key for the sign-in terminal — reaped on exit, so each run is fresh. */
export const GH_SETUP_SESSION_KEY = "screenplay-gh-setup"

/** What the working terminal is running — an install-then-sign-in, or a bare
 *  sign-in — so the section can label it and mount the matching command. */
interface RunPlan {
  command: string[]
  message: string
}

/**
 * The GitHub connection surface in desktop Settings (ADR 0014, PRD #645). It
 * reflects the resolver's *actual* `tokenSource` so it never claims "connected"
 * while the API is dark, and drives a guided setup through the reusable
 * host-tool step in a visible inline host-session terminal: from the
 * not-installed state, one button installs `gh` and chains straight into
 * `gh auth login` (issue #649); a signed-out `gh` just signs in. On PTY exit the
 * section re-detects and flips to Connected with no reload. There is no
 * Disconnect: the `gh` login is the user's, and the app never signs it out.
 */
export function GitHubConnectionPanel() {
  const { status, statusFailed, working, start, onTerminalExit, redetect } =
    useGitHubConnection()

  // The setup terminal is live — show it in place of the status row until the
  // PTY exits and we re-detect.
  if (working) {
    return (
      <div className="space-y-2 rounded-lg border p-4">
        <p className="text-sm text-muted-foreground">{working.message}</p>
        <HostSessionTerminal
          sessionKey={GH_SETUP_SESSION_KEY}
          command={working.command}
          onExit={onTerminalExit}
        />
      </div>
    )
  }

  if (statusFailed) {
    return <LoadErrorRow title="Couldn’t check GitHub" onRetry={redetect} />
  }

  if (!status) {
    return <SettingsRowSkeleton label="Checking connection…" />
  }

  const view = describeConnection(status)
  const action = setupAction(status)

  return (
    <SettingsRowList>
      <SettingsRow
        title="GitHub"
        state={view.state}
        status={view.connected ? "on" : "off"}
        detail={view.detail}
        action={
          action && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => start(action.kind)}
            >
              {action.label}
            </Button>
          )
        }
      />
    </SettingsRowList>
  )
}

/**
 * The GitHub connection's live state and setup actions, shared by the Settings
 * panel and the first-run gate's GitHub step so both read and drive the
 * connection one way. `working` is the run in progress while the setup
 * terminal is live; its exit re-detects.
 */
export function useGitHubConnection() {
  const [state, dispatch] = useReducer(setupReducer, initialSetupState)
  const [status, setStatus] = useState<GitHubLocalStatus | null>(null)
  // Whether Homebrew is on the host PATH, probed up front when `gh` is absent so
  // the install button can pick `brew install gh` vs. the binary fallback
  // synchronously. Irrelevant (and left false) in every other state.
  const [brewPresent, setBrewPresent] = useState(false)
  // The command the working terminal runs, captured at click time (the pre-run
  // phase is gone once we're `working`, so we can't re-derive it there).
  const [run, setRun] = useState<RunPlan | null>(null)
  const [statusFailed, setStatusFailed] = useState(false)

  // Re-probe the resolver and re-fold the setup machine. Used when the
  // connection changes outside the terminal (a `gh auth login` elsewhere) or
  // after a failed check, so the section reflects it at once. Mirrors the mount
  // effect's Homebrew probe so a state that lands on "not installed" still picks
  // the right install command.
  const redetect = useCallback(async () => {
    const s = await getGitHubLocalStatus()
    setStatus(s)
    setStatusFailed(false)
    if (s.tokenSource === null && s.gh === "not-installed") {
      setBrewPresent(await probeHomebrewPresent())
    }
    dispatch({ type: "detected", result: detectionResult(s) })
  }, [])

  // Detect whenever the step is `unknown`: on mount, and again after the setup
  // terminal exits (its `terminal-exited` event returns the step to `unknown`).
  // The fresh result decides the phase, so a finished install+login lands in
  // `authed`. When `gh` is absent we also probe Homebrew, so the Install button's
  // command is ready the moment it's clicked.
  useEffect(() => {
    if (state.phase !== "unknown") return
    let cancelled = false
    getGitHubLocalStatus()
      .then(async (s) => {
        if (cancelled) return
        setStatus(s)
        if (s.tokenSource === null && s.gh === "not-installed") {
          const brew = await probeHomebrewPresent()
          if (cancelled) return
          setBrewPresent(brew)
        }
        dispatch({ type: "detected", result: detectionResult(s) })
      })
      .catch((err) => {
        console.error("Failed to check the GitHub connection", err)
        if (!cancelled) setStatusFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [state.phase])

  // Start a terminal action: remember its command/label, then flip to `working`.
  const start = (kind: SetupActionKind) => {
    setRun(runPlan(kind, brewPresent))
    dispatch({ type: "run-started" })
  }

  const onTerminalExit = () => dispatch({ type: "terminal-exited" })

  return {
    status,
    statusFailed,
    working: state.phase === "working" ? run : null,
    start,
    onTerminalExit,
    redetect,
  }
}

/** A setup terminal action: install `gh` (then chain into sign-in), or just
 *  sign in an already-installed `gh`. */
type SetupActionKind = "install" | "auth"

/** The command + status message for a {@link SetupActionKind}. `install` needs
 *  the brew-presence bit to choose `brew install gh` vs. the binary fallback. */
function runPlan(kind: SetupActionKind, brewPresent: boolean): RunPlan {
  if (kind === "install") {
    return {
      command: buildGhInstallAndAuthArgv(brewPresent),
      message:
        "Installing the GitHub CLI, then signing you in. Follow the prompts " +
        "below; this closes when you’re done.",
    }
  }
  return {
    command: buildGhAuthLoginArgv(),
    message:
      "Signing in to GitHub. Follow the prompts below; this closes when " +
      "you’re done.",
  }
}

/**
 * Map the resolver's status to the setup step's detection result. Keys on the
 * real `tokenSource` for the authed case (a `gh` token that actually resolved),
 * and on the finer `gh` install state otherwise.
 */
function detectionResult(status: GitHubLocalStatus): DetectionResult {
  if (status.tokenSource === "gh") return "authed"
  if (status.gh === "not-installed") return "not-installed"
  return "installed-not-authed"
}

/**
 * The setup affordance, if any. From the disconnected not-installed state, one
 * primary **Install and connect** installs `gh` and chains straight into sign-in
 * (issue #649); a signed-out-but-installed `gh` gets a primary **Sign in**; a
 * `gh` connection gets only a secondary **Sign in again** to refresh a lapsed
 * login (no other clutter — no logout, ADR 0014).
 */
export function setupAction(
  status: GitHubLocalStatus
): { kind: SetupActionKind; label: string; primary: boolean } | null {
  if (status.tokenSource === "gh") {
    return { kind: "auth", label: "Sign in again", primary: false }
  }
  if (status.gh === "installed-not-authenticated") {
    return { kind: "auth", label: "Sign in", primary: true }
  }
  if (status.gh === "not-installed") {
    return { kind: "install", label: "Install and connect", primary: true }
  }
  return null
}

/**
 * Turn the resolver's status into what the GitHub row shows: its state chip
 * and facts line. `connected` keys on the real `tokenSource` — never on the
 * `gh` state alone — so an authed-looking `gh` whose token didn't resolve
 * never reads as connected.
 */
function describeConnection(status: GitHubLocalStatus): {
  connected: boolean
  state: string
  detail?: string
} {
  if (status.tokenSource === "gh") {
    return {
      connected: true,
      state: "Connected",
      detail: status.ghHandle
        ? `@${status.ghHandle} · gh CLI`
        : "Signed in with the gh CLI",
    }
  }
  // tokenSource is null — the API is dark. The gh state says why.
  if (status.gh === "installed-not-authenticated") {
    return {
      connected: false,
      state: "Signed out",
      detail: "gh CLI installed",
    }
  }
  return {
    connected: false,
    state: "Not connected",
    detail: "gh CLI not installed",
  }
}
