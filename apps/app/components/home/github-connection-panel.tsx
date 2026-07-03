"use client"

import { useCallback, useEffect, useReducer, useState } from "react"
import { ExternalLink, Plug } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"
import { openExternal } from "@/lib/open-external"
import {
  beginGitHubDeviceFlow,
  completeGitHubDeviceFlow,
  disconnectGitHub,
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
 * section re-detects and flips to Connected with no reload. The device flow
 * (issue #650) is the relocated fallback — offered here when configured, for a
 * user who'd rather not use `gh` — alongside a Disconnect that clears only the
 * app's own device-flow token.
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
  const [deviceOpen, setDeviceOpen] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  // Re-probe the resolver and re-fold the setup machine. Used by actions that
  // change the connection outside the terminal — a device-flow success or a
  // Disconnect — so the section reflects them at once. Mirrors the mount effect's
  // Homebrew probe so a state that lands on "not installed" still picks the right
  // install command.
  const redetect = useCallback(async () => {
    const s = await getGitHubLocalStatus()
    setStatus(s)
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

  const disconnect = async () => {
    setDisconnecting(true)
    try {
      await disconnectGitHub()
      await redetect()
    } finally {
      setDisconnecting(false)
    }
  }

  // The device flow is the fallback (ADR 0014): offered only when it's
  // configured and no token has resolved — for a user who'd rather not use `gh`,
  // or whose install failed / is offline.
  const showDeviceFallback =
    status.tokenSource === null && status.deviceFlowConfigured

  return (
    <div className="space-y-2">
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

      {/* Fallback connect + Disconnect. "Disconnect" keys on `hasDeviceToken`,
          not `tokenSource` — a dormant device token can sit *under* a `gh`
          connection (the resolver prefers `gh`), and it clears only the
          app-stored device token, never the `gh` login the user relies on
          outside the app (ADR 0014: one-directional help, no `gh auth logout`). */}
      {(showDeviceFallback || status.hasDeviceToken) && (
        <div className="flex items-center gap-2 px-1">
          {showDeviceFallback && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="font-normal text-muted-foreground"
              onClick={() => setDeviceOpen(true)}
            >
              Connect with a device code instead
            </Button>
          )}
          {status.hasDeviceToken && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disconnecting}
              className="font-normal text-muted-foreground"
              onClick={disconnect}
            >
              {disconnecting && <Spinner className="size-4" />}
              Disconnect
            </Button>
          )}
        </div>
      )}

      {deviceOpen && (
        <ConnectGitHubDialog
          onDone={(connected) => {
            setDeviceOpen(false)
            if (connected) redetect()
          }}
        />
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

type ConnectState =
  | { step: "starting" }
  | { step: "authorize"; userCode: string; verificationUri: string }
  | { step: "failed"; message: string }

/**
 * The device-flow connect dialog (ADR 0014's fallback path, relocated from the
 * repo picker): show the short user code, send the user to github.com to
 * authorize, and wait for the poll loop (held open server-side) to land on a
 * terminal outcome. Optional and on-demand — closing it just means no
 * device-flow token, never a blocked app or a touched `gh` login.
 */
function ConnectGitHubDialog({
  onDone,
}: {
  onDone: (connected: boolean) => void
}) {
  const [state, setState] = useState<ConnectState>({ step: "starting" })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const begun = await beginGitHubDeviceFlow()
      if (cancelled) return
      if (!begun.ok) {
        setState({ step: "failed", message: begun.error })
        return
      }
      setState({
        step: "authorize",
        userCode: begun.grant.userCode,
        verificationUri: begun.grant.verificationUri,
      })
      const outcome = await completeGitHubDeviceFlow(begun.grant)
      if (cancelled) return
      if (outcome.status === "authorized") {
        onDone(true)
      } else {
        setState({
          step: "failed",
          message:
            outcome.status === "denied"
              ? "Authorization was denied."
              : outcome.status === "expired"
                ? "The code expired — try connecting again."
                : outcome.message,
        })
      }
    })()
    return () => {
      cancelled = true
    }
    // Deliberately mount-once: the flow must not restart on re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Connect GitHub</DialogTitle>
          <DialogDescription>
            Authorize Screenplay in your browser to browse your repositories and
            open pull requests. This is API access only — there is still no
            login.
          </DialogDescription>
        </DialogHeader>
        {state.step === "starting" && (
          <div className="flex items-center gap-2 py-2">
            <Spinner className="size-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Requesting a device code…
            </span>
          </div>
        )}
        {state.step === "authorize" && (
          <div className="flex flex-col items-center gap-3 py-2">
            <span className="font-mono text-2xl tracking-widest">
              {state.userCode}
            </span>
            <a
              href={state.verificationUri}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                // Desktop webview can't honor target="_blank"; route the
                // GitHub device-flow link through the opener plugin.
                e.preventDefault()
                openExternal(state.verificationUri)
              }}
              className="inline-flex items-center gap-1 text-sm underline"
            >
              Enter this code at {state.verificationUri}
              <ExternalLink className="size-3.5" />
            </a>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              Waiting for authorization…
            </div>
          </div>
        )}
        {state.step === "failed" && (
          <span className="py-2 text-sm text-destructive">{state.message}</span>
        )}
      </DialogContent>
    </Dialog>
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
