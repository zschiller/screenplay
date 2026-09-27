"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  ConnectGitHubDialog,
  GH_SETUP_SESSION_KEY,
  setupAction,
  useGitHubConnection,
} from "@/components/home/github-connection-panel"
import { HostSessionTerminal } from "@/components/agent/host-session-terminal"
import { LoadErrorRow } from "@/components/home/load-error"
import { CollapsedSetupStep, CurrentSetupStep, SetupChip } from "./setup-step"

/**
 * Step 2 of the setup gate: GitHub, which is optional. It runs on the same
 * connection hook as the Settings panel (install `gh` and sign in, or sign in,
 * in the inline host terminal; the device code as a fallback) and adds Skip,
 * which the gate persists. Collapsed, it shows a green tick once connected and a
 * grey dash once skipped.
 */
export function GitHubStep({
  current,
  satisfied,
  skipped,
  onChange,
  onCollapse,
  onSkip,
}: {
  current: boolean
  /** The gate's release fact for a real connection (not a skip). */
  satisfied: boolean
  skipped: boolean
  /** Reopen the step from its collapsed row. */
  onChange: () => void
  /** Close a step reopened with Change. */
  onCollapse: () => void
  onSkip: () => void
}) {
  const connection = useGitHubConnection()
  const { status, redetect } = connection
  const [deviceOpen, setDeviceOpen] = useState(false)

  // The gate's poll saw the connection change outside this step (a `gh auth
  // login` in another terminal): read it again so the row names the account.
  const seenSatisfied = useRef(satisfied)
  useEffect(() => {
    if (seenSatisfied.current === satisfied) return
    seenSatisfied.current = satisfied
    redetect().catch((err) =>
      console.error("Failed to re-check the GitHub connection", err)
    )
  }, [satisfied, redetect])

  const connected = status ? status.tokenSource !== null : satisfied

  if (!current) {
    return (
      <CollapsedSetupStep
        step={2}
        state={connected ? "done" : skipped ? "skipped" : "upcoming"}
        title={connected || skipped ? "GitHub" : "Connect GitHub"}
        summary={
          connected
            ? status?.ghHandle
              ? `Connected as @${status.ghHandle}`
              : "Connected"
            : skipped
              ? "Skipped"
              : undefined
        }
        chip={
          connected || skipped ? undefined : <SetupChip>Optional</SetupChip>
        }
        onChange={connected || skipped ? onChange : undefined}
      />
    )
  }

  const action = status ? setupAction(status) : null
  // The device flow is the fallback (ADR 0014): offered only when it's
  // configured and no token has resolved.
  const showDeviceFallback =
    status?.tokenSource === null && status.deviceFlowConfigured

  return (
    <CurrentSetupStep
      step={2}
      title="Connect GitHub"
      chip={<SetupChip>Optional</SetupChip>}
    >
      <p className="text-[13px] text-muted-foreground">
        {connected
          ? status?.ghHandle
            ? `Connected as @${status.ghHandle}.`
            : "Connected."
          : "Browse your repositories and open pull requests from Screenplay. You can add a project from a folder or clone URL without it."}
      </p>
      {connection.working ? (
        <div className="space-y-2">
          <p className="text-[13px] text-muted-foreground">
            {connection.working.message}
          </p>
          <HostSessionTerminal
            sessionKey={GH_SETUP_SESSION_KEY}
            command={connection.working.command}
            onExit={connection.onTerminalExit}
          />
        </div>
      ) : connection.statusFailed ? (
        <LoadErrorRow title="Couldn't check GitHub" onRetry={redetect} />
      ) : !status ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" />
          Checking GitHub…
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {connected ? (
            <>
              <Button type="button" onClick={onCollapse}>
                Done
              </Button>
              {status.hasDeviceToken && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={connection.disconnecting}
                  onClick={connection.disconnect}
                >
                  {connection.disconnecting && <Spinner className="size-4" />}
                  Disconnect
                </Button>
              )}
            </>
          ) : (
            <>
              {action && (
                <Button
                  type="button"
                  onClick={() => connection.start(action.kind)}
                >
                  {action.kind === "install"
                    ? "Install GitHub CLI and connect"
                    : "Sign in to GitHub"}
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={onSkip}>
                Skip
              </Button>
              {showDeviceFallback && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => setDeviceOpen(true)}
                >
                  Use a device code
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {deviceOpen && (
        <ConnectGitHubDialog
          onDone={(ok) => {
            setDeviceOpen(false)
            if (ok) redetect()
          }}
        />
      )}
    </CurrentSetupStep>
  )
}
