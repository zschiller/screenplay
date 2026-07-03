"use client"

import { useEffect, useReducer, useState } from "react"
import { Plug } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
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

/** Stable PTY key for the sign-in terminal — reaped on exit, so each run is fresh. */
const GH_SETUP_SESSION_KEY = "screenplay-gh-setup"

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
 * section re-detects and flips to Connected with no reload.
 */
export function GitHubConnectionPanel() {
  const [state, dispatch] = useReducer(setupReducer, initialSetupState)
  const [status, setStatus] = useState<GitHubLocalStatus | null>(null)
  // Whether Homebrew is on the host PATH, probed up front when `gh` is absent so
  // the install button can pick `brew install gh` vs. the binary fallback
  // synchronously. Irrelevant (and left false) in every other state.
  const [brewPresent, setBrewPresent] = useState(false)
  // The command the working terminal runs, captured at click time (the pre-run
  // phase is gone once we're `working`, so we can't re-derive it there).
  const [run, setRun] = useState<RunPlan | null>(null)

  // Detect whenever the step is `unknown`: on mount, and again after the setup
  // terminal exits (its `terminal-exited` event returns the step to `unknown`).
  // The fresh result decides the phase, so a finished install+login lands in
  // `authed`. When `gh` is absent we also probe Homebrew, so the Install button's
  // command is ready the moment it's clicked.
  useEffect(() => {
    if (state.phase !== "unknown") return
    let cancelled = false
    getGitHubLocalStatus().then(async (s) => {
      if (cancelled) return
      setStatus(s)
      if (s.tokenSource === null && s.gh === "not-installed") {
        const brew = await probeHomebrewPresent()
        if (cancelled) return
        setBrewPresent(brew)
      }
      dispatch({ type: "detected", result: detectionResult(s) })
    })
    return () => {
      cancelled = true
    }
  }, [state.phase])

  // Start a terminal action: remember its command/label, then flip to `working`.
  function start(plan: RunPlan) {
    setRun(plan)
    dispatch({ type: "run-started" })
  }

  // The setup terminal is live — show it in place of the status row until the
  // PTY exits and we re-detect.
  if (state.phase === "working" && run) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{run.message}</p>
        <HostSessionTerminal
          sessionKey={GH_SETUP_SESSION_KEY}
          command={run.command}
          onExit={() => dispatch({ type: "terminal-exited" })}
        />
      </div>
    )
  }

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Checking connection…
      </div>
    )
  }

  const view = describeConnection(status)
  const action = setupAction(status)

  return (
    <div className="flex items-center gap-3 rounded-lg border p-4">
      <Plug className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              view.connected ? "bg-emerald-500" : "bg-muted-foreground/40"
            )}
            aria-hidden
          />
          <span className="text-sm font-medium">{view.title}</span>
        </div>
        <p className="text-sm text-muted-foreground">{view.detail}</p>
      </div>
      {action && (
        <Button
          type="button"
          size="sm"
          variant={action.primary ? "default" : "outline"}
          onClick={() => start(runPlan(action.kind, brewPresent))}
        >
          {action.label}
        </Button>
      )}
    </div>
  )
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
        "Installing the GitHub CLI, then signing you in — follow the prompts " +
        "below. Once the browser flow finishes, this closes and the connection " +
        "updates automatically.",
    }
  }
  return {
    command: buildGhAuthLoginArgv(),
    message:
      "Signing in to GitHub — follow the prompts below. Once the browser flow " +
      "finishes, this closes and the connection updates automatically.",
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
 * primary **Install & connect** installs `gh` and chains straight into sign-in
 * (issue #649); a signed-out-but-installed `gh` gets a primary **Sign in**; a
 * `gh` connection gets only a secondary **Re-run sign-in** to refresh a lapsed
 * login (no other clutter — no logout, ADR 0014). A device connection (with or
 * without `gh`) already has API access, so it offers nothing here.
 */
function setupAction(
  status: GitHubLocalStatus
): { kind: SetupActionKind; label: string; primary: boolean } | null {
  if (status.tokenSource === "gh") {
    return { kind: "auth", label: "Re-run sign-in", primary: false }
  }
  if (status.tokenSource === null) {
    if (status.gh === "installed-not-authenticated") {
      return { kind: "auth", label: "Sign in", primary: true }
    }
    if (status.gh === "not-installed") {
      return { kind: "install", label: "Install & connect", primary: true }
    }
  }
  return null
}

/**
 * Turn the resolver's status into what the section shows. `connected` keys on
 * the real `tokenSource` — never on the `gh` state alone — so a signed-out `gh`
 * with a live device token still reads as connected, and an authed-looking `gh`
 * whose token didn't resolve never does.
 */
function describeConnection(status: GitHubLocalStatus): {
  connected: boolean
  title: string
  detail: string
} {
  if (status.tokenSource === "gh") {
    return {
      connected: true,
      title: status.ghHandle ? `Connected as @${status.ghHandle}` : "Connected",
      detail: "Using the gh CLI's login for GitHub API access.",
    }
  }
  if (status.tokenSource === "device") {
    return {
      connected: true,
      title: "Connected",
      detail: "Using a device-flow token for GitHub API access.",
    }
  }
  // tokenSource is null — the API is dark. The gh state says why.
  if (status.gh === "installed-not-authenticated") {
    return {
      connected: false,
      title: "Installed · signed out",
      detail: "The gh CLI is installed but not signed in to GitHub.",
    }
  }
  return {
    connected: false,
    title: "Not installed",
    detail: "The gh CLI isn't installed, so GitHub API features are off.",
  }
}
