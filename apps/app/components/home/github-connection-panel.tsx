"use client"

import { useEffect, useState } from "react"
import { Plug } from "lucide-react"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import {
  getGitHubLocalStatus,
  type GitHubLocalStatus,
} from "@/lib/github-local/actions"

/**
 * The read-only GitHub connection surface in desktop Settings (ADR 0014, the
 * first slice of PRD #645). It reflects the resolver's *actual* `tokenSource`
 * so it never claims "connected" while the API is dark, and uses the finer
 * `gh` install/auth state to say whether the next step is *install* or
 * *sign in*. No connect actions yet — those land in later slices.
 */
export function GitHubConnectionPanel() {
  const [status, setStatus] = useState<GitHubLocalStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    getGitHubLocalStatus().then((s) => {
      if (!cancelled) setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Checking connection…
      </div>
    )
  }

  const view = describeConnection(status)

  return (
    <div className="flex items-center gap-3 rounded-lg border p-4">
      <Plug className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 space-y-0.5">
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
    </div>
  )
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
