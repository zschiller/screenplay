"use client"

import { useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { GitHubConnectionPanel } from "@/components/home/github-connection-panel"
import { HarnessSetupPanel } from "@/components/home/harness-setup-panel"
import { getLocalSetupGateStatus } from "@/lib/local-setup/gate-status"
import { writeGitHubSkip } from "@/lib/local-setup/github-skip"
import { isLocalSetupComplete } from "@/lib/local-setup/is-complete"

/** Modest poll cadence (ADR 0016) — brisk enough that Finish lights up within a
 *  beat of terminal sign-in, slow enough to not busy-loop while blocked. */
const POLL_INTERVAL_MS = 1800

/**
 * The desktop first-run blocking gate (ADR 0016), mounted once at the root
 * layout and `isLocalBuild`-gated by its caller. When a launch lands blocked it
 * renders **only** the setup flow — no browsable app behind it — with both steps
 * visible at once: **Step 1** mounts the existing {@link HarnessSetupPanel} (the
 * hard requirement, led with so it can't be skipped past) and **Step 2** mounts
 * the existing {@link GitHubConnectionPanel} verbatim (its own inline
 * host-session terminal, device-flow fallback, live re-detect). A single gated
 * **Finish** opens the app the instant the release condition holds.
 *
 * Both panels are visible together rather than a strict one-step-at-a-time
 * wizard — that would fight the panels' self-contained live re-detect and would
 * hide an already-green GitHub state from a user whose `gh` login is already
 * present. The harness half **hard-blocks**; the GitHub half honors the ADR 0008
 * no-auth floor, so Step 2 offers a **"Skip for now"** that persists (a cookie,
 * read server-side next launch) and releases the GitHub half.
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
  initiallyGithubSkipped,
  children,
}: {
  initiallyBlocked: boolean
  initiallyGithubSkipped: boolean
  children: React.ReactNode
}) {
  // Launch-scoped: seed both from the server's initial decision so the first
  // paint is already correct (no gate-over-app or app-over-gate flash). A
  // not-blocked launch is `opened` from the start and never mounts the gate.
  const [opened, setOpened] = useState(!initiallyBlocked)
  const [released, setReleased] = useState(!initiallyBlocked)
  // Seeded from the server-parsed skip cookie so the poll folds the same GitHub
  // half the initial paint did; clicking "Skip for now" flips it true (and
  // persists the cookie) so the very next poll can release without a reload.
  const [githubSkipped, setGithubSkipped] = useState(initiallyGithubSkipped)

  // Poll the release facts ONLY while still blocked, and stop the moment the
  // condition is met — no perpetual loop on a healthy session. Re-runs when the
  // skip bit flips so a fresh skip is folded in on the next tick.
  useEffect(() => {
    if (released) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const poll = async () => {
      const status = await getLocalSetupGateStatus()
      if (cancelled) return
      if (isLocalSetupComplete({ ...status, githubSkipped })) {
        setReleased(true)
        return
      }
      timer = setTimeout(poll, POLL_INTERVAL_MS)
    }

    timer = setTimeout(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [released, githubSkipped])

  const skip = () => {
    writeGitHubSkip()
    setGithubSkipped(true)
  }

  if (opened) return <>{children}</>

  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-xl space-y-8">
        <div className="space-y-2">
          <h1 className="text-2xl font-medium">Set up Screenplay</h1>
          <p className="text-sm text-muted-foreground">
            Screenplay backs agent chat and terminal tabs with a coding CLI on
            this device. Install and sign in to at least one to get started;
            connecting GitHub is optional.
          </p>
        </div>

        <section className="space-y-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-medium">1 · Install a coding agent</h2>
            <p className="text-sm text-muted-foreground">
              Pick one to install and sign in. This updates automatically the
              moment sign-in finishes.
            </p>
          </div>
          <HarnessSetupPanel />
        </section>

        <section className="space-y-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-medium">
              2 · Connect GitHub (optional)
            </h2>
            <p className="text-sm text-muted-foreground">
              Lights up repo listing, Branch-via-API, and pull requests. You can
              skip this — adding a repo by URL or local folder needs no
              connection — and connect later in Settings.
            </p>
          </div>
          <GitHubConnectionPanel />
          {githubSkipped ? (
            <p className="px-1 text-sm text-muted-foreground">
              Skipped — you can connect GitHub anytime from Settings.
            </p>
          ) : (
            <div className="flex justify-start">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="font-normal text-muted-foreground"
                onClick={skip}
              >
                Skip for now
              </Button>
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <Button
            type="button"
            disabled={!released}
            onClick={() => setOpened(true)}
          >
            Finish
          </Button>
        </div>
      </div>
    </div>
  )
}
