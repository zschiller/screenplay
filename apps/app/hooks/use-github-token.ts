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

/**
 * The same probe, with `undefined` until it resolves, for a surface that shows
 * something different once it knows there is no token (Create pull request's
 * Connect GitHub hint) and must not flash it while asking.
 */
export function useGitHubTokenProbe(): boolean | undefined {
  const [available, setAvailable] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    hasGitHubToken()
      .then((ok) => {
        if (!cancelled) setAvailable(ok)
      })
      .catch(() => {
        // No token as far as anyone can tell: the API-dark presentation.
        if (!cancelled) setAvailable(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return available
}
