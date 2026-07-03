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
import {
  initialSetupState,
  setupReducer,
  type DetectionResult,
} from "@/lib/host-tool/setup-step"
import { HostSessionTerminal } from "@/components/agent/host-session-terminal"

/** Stable PTY key for the sign-in terminal — reaped on exit, so each run is fresh. */
const GH_SETUP_SESSION_KEY = "screenplay-gh-setup"

/**
 * The GitHub connection surface in desktop Settings (ADR 0014, PRD #645). It
 * reflects the resolver's *actual* `tokenSource` so it never claims "connected"
 * while the API is dark, and — for a `gh` that's installed but signed out —
 * drives a guided **sign-in** through the reusable host-tool setup step: a
 * visible inline host-session terminal runs `gh auth login --web`, and on PTY
 * exit the section re-detects and flips to Connected with no reload.
 */
export function GitHubConnectionPanel() {
  const [state, dispatch] = useReducer(setupReducer, initialSetupState)
  const [status, setStatus] = useState<GitHubLocalStatus | null>(null)

  // Detect whenever the step is `unknown`: on mount, and again after the sign-in
  // terminal exits (its `terminal-exited` event returns the step to `unknown`).
  // The fresh result decides the phase, so a finished login lands in `authed`.
  useEffect(() => {
    if (state.phase !== "unknown") return
    let cancelled = false
    getGitHubLocalStatus().then((s) => {
      if (cancelled) return
      setStatus(s)
      dispatch({ type: "detected", result: detectionResult(s) })
    })
    return () => {
      cancelled = true
    }
  }, [state.phase])

  // The sign-in terminal is live — show it in place of the status row until the
  // PTY exits and we re-detect.
  if (state.phase === "working") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Signing in to GitHub — follow the prompts below. Once the browser flow
          finishes, this closes and the connection updates automatically.
        </p>
        <HostSessionTerminal
          sessionKey={GH_SETUP_SESSION_KEY}
          command={buildGhAuthLoginArgv()}
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
  const action = signInAction(status)

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
          onClick={() => dispatch({ type: "run-started" })}
        >
          {action.label}
        </Button>
      )}
    </div>
  )
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
 * The sign-in affordance, if any. A signed-out-but-installed `gh` gets a primary
 * **Sign in**; a `gh` connection gets only a secondary **Re-run sign-in** to
 * refresh a lapsed login (no other clutter — no logout, ADR 0014). Every other
 * state (device-connected, not installed) offers nothing here.
 */
function signInAction(
  status: GitHubLocalStatus
): { label: string; primary: boolean } | null {
  if (status.tokenSource === "gh") {
    return { label: "Re-run sign-in", primary: false }
  }
  if (
    status.tokenSource === null &&
    status.gh === "installed-not-authenticated"
  ) {
    return { label: "Sign in", primary: true }
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
