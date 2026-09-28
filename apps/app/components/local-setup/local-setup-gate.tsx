"use client"

import { useEffect, useId, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Button } from "@workspace/ui/components/button"
import { Spinner } from "@workspace/ui/components/spinner"
import { ScreenplayLogo } from "@/components/screenplay-logo"
import { getLocalSetupGateStatus } from "@/lib/local-setup/gate-status"
import { writeGitHubSkip } from "@/lib/local-setup/github-skip"
import { isLocalSetupComplete } from "@/lib/local-setup/is-complete"
import { markGettingStartedCanvas } from "@/lib/getting-started"
import { createRoom } from "@/lib/rooms-actions"
import { prewarmRoom } from "@/lib/yjs-host/client"
import { AgentStep } from "./agent-step"
import { GitHubStep } from "./github-step"

/** Modest poll cadence (ADR 0016) — brisk enough that Finish lights up within a
 *  beat of terminal sign-in, slow enough to not busy-loop while blocked. */
const POLL_INTERVAL_MS = 1800

/**
 * The desktop first-run blocking gate (ADR 0016), mounted once at the root
 * layout and `isLocalBuild`-gated by its caller. When a launch lands blocked it
 * renders **only** the setup flow — no browsable app behind it — as a two-step
 * stepper: **Step 1** a coding agent ({@link AgentStep}, the hard requirement,
 * led with so it can't be skipped past) and **Step 2** GitHub
 * ({@link GitHubStep}). Only the current step is expanded; a settled step
 * collapses to one row with the choice made and Change to reopen it. A single
 * gated **Finish** opens the app the instant the release condition holds, on a
 * new Canvas whose empty state is the getting-started checklist (#780).
 *
 * The harness half **hard-blocks**; the GitHub half honors the ADR 0008 no-auth
 * floor, so Step 2 offers **Skip**, which persists (a cookie, read server-side
 * next launch) and releases the GitHub half. A skipped step shows a grey dash,
 * never the done tick.
 *
 * The gate owns the release truth by **polling** the shared
 * {@link getLocalSetupGateStatus} action and folding it — with the skip bit —
 * through the shared {@link isLocalSetupComplete} predicate, never by the panels
 * reporting upward, which on a screen the user can't escape could hang Finish
 * forever on a single missed transition. It polls **only while blocked** and
 * **stops the moment** the condition is met.
 *
 * Re-evaluation is **launch-scoped**: `initiallyBlocked` is computed server-side
 * at each hard load, so a launch that lands *not blocked* renders the app and
 * never re-blocks mid-session (no watchdog), and a launch that lands *blocked*
 * polls until released, then stops.
 */
export function LocalSetupGate({
  initiallyBlocked,
  initialStatus,
  initiallyGithubSkipped,
  children,
}: {
  initiallyBlocked: boolean
  /** The release facts the server read for the first paint. */
  initialStatus: { harnessSatisfied: boolean; githubSatisfied: boolean }
  initiallyGithubSkipped: boolean
  children: React.ReactNode
}) {
  // Launch-scoped: seed from the server's initial decision so the first paint
  // is already correct (no gate-over-app or app-over-gate flash). A not-blocked
  // launch is `opened` from the start and never mounts the gate.
  const [opened, setOpened] = useState(!initiallyBlocked)
  // The last release facts read; each step shows its own half.
  const [status, setStatus] = useState(initialStatus)
  // Seeded from the server-parsed skip cookie so the gate folds the same GitHub
  // half the initial paint did; clicking Skip flips it true (and
  // persists the cookie), which releases at once if the harness half holds.
  const [githubSkipped, setGithubSkipped] = useState(initiallyGithubSkipped)
  const released =
    !initiallyBlocked || isLocalSetupComplete({ ...status, githubSkipped })
  const harnessDone = status.harnessSatisfied
  const githubDone = status.githubSatisfied || githubSkipped
  const finishReasonId = useId()
  // A settled step the person reopened with Change, if any.
  const [reopened, setReopened] = useState<1 | 2 | null>(null)

  // Finish makes the first Canvas and opens the app on it. The gate stays up
  // until the route has moved, so home never flashes in between.
  const router = useRouter()
  const pathname = usePathname()
  const [finishingTo, setFinishingTo] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  if (finishingTo && pathname === finishingTo && !opened) setOpened(true)
  const finish = async () => {
    setFinishing(true)
    try {
      const room = await createRoom("Untitled")
      markGettingStartedCanvas(room.id)
      prewarmRoom(room.id)
      const path = `/${room.id}`
      setFinishingTo(path)
      router.push(path)
    } catch (err) {
      // The app is usable without it: open wherever the launch landed.
      console.error("Failed to create the first canvas", err)
      setOpened(true)
    }
  }

  // Poll the release facts ONLY while still blocked, and stop the moment the
  // condition is met — no perpetual loop on a healthy session.
  useEffect(() => {
    if (released) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const poll = async () => {
      try {
        const next = await getLocalSetupGateStatus()
        if (cancelled) return
        // A release re-renders with `released` true, which cancels the loop.
        setStatus(next)
      } catch (err) {
        // A transient failure (the sidecar busy or restarting) must not end
        // the loop: nothing else would ever release Finish.
        console.error("Failed to read setup status", err)
        if (cancelled) return
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS)
    }

    timer = setTimeout(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [released])

  const skip = () => {
    writeGitHubSkip()
    setGithubSkipped(true)
    setReopened(null)
  }

  // Reopen a step that's already settled; otherwise the first unsettled step
  // is the one expanded.
  const current: 1 | 2 | null =
    reopened ?? (!harnessDone ? 1 : !githubDone ? 2 : null)

  if (opened) return <>{children}</>

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-12">
      <div className="flex w-full max-w-md flex-col gap-4">
        <div className="flex flex-col gap-1">
          <ScreenplayLogo className="mb-3 size-10" />
          <span className="text-xs font-medium text-muted-foreground">
            {current ? `Step ${current} of 2` : "Ready to finish"}
          </span>
          <h1 className="text-xl font-semibold tracking-tight">
            Set up Screenplay
          </h1>
        </div>

        <AgentStep
          current={current === 1}
          done={harnessDone}
          onChange={() => setReopened(1)}
          onCollapse={() => setReopened(null)}
        />
        <GitHubStep
          current={current === 2}
          satisfied={status.githubSatisfied}
          skipped={githubSkipped}
          onChange={() => setReopened(2)}
          onCollapse={() => setReopened(null)}
          onSkip={skip}
        />

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="text-xs text-muted-foreground">
            You can change these later in Settings.
          </p>
          {!released && (
            <span id={finishReasonId} className="sr-only">
              {finishBlockedReason({ harnessDone, githubDone })}
            </span>
          )}
          <Button
            type="button"
            disabled={!released || finishing}
            aria-describedby={released ? undefined : finishReasonId}
            onClick={finish}
          >
            {finishing && <Spinner />}
            Finish
          </Button>
        </div>
      </div>
    </div>
  )
}

/** What still stands between the person and Finish, in one line. */
export function finishBlockedReason({
  harnessDone,
  githubDone,
}: {
  harnessDone: boolean
  githubDone: boolean
}): string {
  if (!harnessDone && !githubDone) {
    return "Sign in to a coding agent, and connect or skip GitHub, to finish."
  }
  if (!harnessDone) return "Sign in to a coding agent to finish."
  return "Connect GitHub or skip it to finish."
}
