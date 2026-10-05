"use client"

import { useEffect, useState } from "react"

import { hasGitHubToken } from "@/lib/github-actions"

/**
 * Whether the GitHub API is reachable for this user, for client surfaces that
 * gate a GitHub-API-only affordance on it (issue #741: the Workspace delete
 * dialog only offers "Also delete on remote" when the API could actually serve
 * it). Probed once — a token appears or disappears through Settings, which
 * remounts the surfaces that care.
 *
 * `false` until the probe resolves and on any failure, so a surface reading it
 * starts from "the API is dark" and only ever *gains* an affordance. That is the
 * safe direction for a destructive one, and the honest default under the no-auth
 * floor (ADR 0008), where no token is the ordinary desktop state.
 */
export function useGitHubTokenAvailable(): boolean {
  return useGitHubTokenProbe() === true
}

// One probe at a time, shared by every surface that mounts while it's in
// flight (each Workspace menu row asks), and the last answer, which a surface
// mounting later starts from while it asks again.
let inflight: Promise<boolean> | null = null
let lastKnown: boolean | undefined

function probe(): Promise<boolean> {
  inflight ??= hasGitHubToken()
    .catch(() => false)
    .then((ok) => {
      lastKnown = ok
      return ok
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/**
 * The same probe, with `undefined` until it first resolves, for a surface that
 * shows something different once it knows there is no token (Create pull
 * request's Connect GitHub hint) and must not flash it while asking.
 */
export function useGitHubTokenProbe(): boolean | undefined {
  const [available, setAvailable] = useState<boolean | undefined>(lastKnown)

  useEffect(() => {
    let cancelled = false
    void probe().then((ok) => {
      if (!cancelled) setAvailable(ok)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return available
}
