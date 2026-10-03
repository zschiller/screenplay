import "server-only"

import { makeGhCli, type GhCli } from "@/lib/github-local/gh-cli"
import type { GhStatus } from "@/lib/github-local/gh-cli"

/**
 * The local build's implementation of the `getGitHubToken()` seam (PRD #428):
 * the host `gh` CLI's token when the CLI is installed and authenticated, else
 * `null` (ADR 0018 dropped the device-flow fallback). Because this resolves
 * *behind* the existing seam in `auth-helpers`, every GitHub API call site
 * (repo listing, Branch-via-API, PR creation, Branch naming) lights up
 * unmodified the moment `gh` yields a token; `null` keeps meaning "API features
 * dark", which the UI already handles as the no-token state.
 */
export function makeGitHubTokenResolver(deps: {
  gh: Pick<GhCli, "getToken">
}): () => Promise<string | null> {
  return () => deps.gh.getToken()
}

const productionResolver = makeGitHubTokenResolver({ gh: makeGhCli() })

export function resolveLocalGitHubToken(): Promise<string | null> {
  return productionResolver()
}

/**
 * Where a token resolves right now (`gh`, or `null`): the one fact the
 * first-run gate needs. Unlike {@link readLocalGitHubConnection} it skips
 * `gh --version` and the `gh api user` handle lookup, a GitHub round trip that
 * would otherwise hold up every hard load (app launch included), and stall it
 * offline.
 */
export function makeLocalGitHubTokenSourceReader(deps: {
  gh: Pick<GhCli, "getToken">
}): () => Promise<"gh" | null> {
  return async () => ((await deps.gh.getToken()) ? "gh" : null)
}

const productionTokenSourceReader = makeLocalGitHubTokenSourceReader({
  gh: makeGhCli(),
})

export function readLocalGitHubTokenSource(): Promise<"gh" | null> {
  return productionTokenSourceReader()
}

/** Which of the three states the host `gh` CLI is in — the connection UI's
 *  install-vs-sign-in distinction, mirroring {@link GhStatus} without the
 *  token payload. */
export type GhConnectionState = GhStatus["kind"]

/**
 * The full picture the local-build connection UI reads (ADR 0014): the
 * resolver's real {@link tokenSource} alongside the finer `gh` install/auth
 * state and its handle.
 */
export interface LocalGitHubConnection {
  tokenSource: "gh" | null
  gh: GhConnectionState
  /** The connected GitHub handle, only ever set when `tokenSource === "gh"`. */
  ghHandle: string | null
}

export function makeLocalGitHubConnectionReader(deps: {
  gh: Pick<GhCli, "getStatus">
}): () => Promise<LocalGitHubConnection> {
  return async () => {
    const status = await deps.gh.getStatus()
    if (status.kind === "authenticated") {
      return { tokenSource: "gh", gh: "authenticated", ghHandle: status.handle }
    }
    return { tokenSource: null, gh: status.kind, ghHandle: null }
  }
}

const productionConnectionReader = makeLocalGitHubConnectionReader({
  gh: makeGhCli(),
})

export function readLocalGitHubConnection(): Promise<LocalGitHubConnection> {
  return productionConnectionReader()
}
