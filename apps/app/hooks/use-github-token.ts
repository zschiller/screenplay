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
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    hasGitHubToken()
      .then((ok) => {
        if (!cancelled) setAvailable(ok)
      })
      .catch(() => {
        // Leave it false — the caller keeps the API-dark presentation.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return available
}
