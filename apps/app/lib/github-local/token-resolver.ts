import "server-only"

import { makeGhCli, type GhCli } from "@/lib/github-local/gh-cli"
import type { GhStatus } from "@/lib/github-local/gh-cli"
import {
  getLocalTokenStore,
  type TokenStore,
} from "@/lib/github-local/token-store"

/**
 * The local build's implementation of the `getGitHubToken()` seam (PRD #428):
 * one explicit priority order — (1) the `gh` CLI's token when the CLI is
 * installed and authenticated, (2) a device-flow token from the local
 * {@link TokenStore}, (3) `null`. Because this resolves *behind* the existing
 * seam in `auth-helpers`, every GitHub API call site (repo listing,
 * Branch-via-API, PR creation, Branch naming) lights up unmodified the moment
 * either source yields a token; `null` keeps meaning "API features dark",
 * which the UI already handles as the no-token state.
 */
export function makeGitHubTokenResolver(deps: {
  gh: Pick<GhCli, "getToken">
  store: () => Promise<TokenStore>
}): () => Promise<string | null> {
  return async () => {
    const ghToken = await deps.gh.getToken()
    if (ghToken) return ghToken
    const store = await deps.store()
    return store.get()
  }
}

const productionResolver = makeGitHubTokenResolver({
  gh: makeGhCli(),
  store: getLocalTokenStore,
})

export function resolveLocalGitHubToken(): Promise<string | null> {
  return productionResolver()
}

/** Which of the three states the host `gh` CLI is in — the connection UI's
 *  install-vs-sign-in distinction, mirroring {@link GhStatus} without the
 *  token payload. */
export type GhConnectionState = GhStatus["kind"]

/**
 * The full picture the local-build connection UI reads (ADR 0014). Reports the
 * resolver's real {@link tokenSource} — `"gh"` outranks a stored device-flow
 * token exactly as {@link makeGitHubTokenResolver} does — alongside the finer
 * `gh` install/auth state and its handle. `hasDeviceToken` is reported
 * **additively**: because the resolver prefers `gh`, a dormant device token can
 * sit under a `gh` connection, so "a device token exists" is a separate fact
 * from what `tokenSource` currently is.
 */
export interface LocalGitHubConnection {
  tokenSource: "gh" | "device" | null
  gh: GhConnectionState
  /** The connected GitHub handle, only ever set when `tokenSource === "gh"`. */
  ghHandle: string | null
  hasDeviceToken: boolean
}

export function makeLocalGitHubConnectionReader(deps: {
  gh: Pick<GhCli, "getStatus">
  store: () => Promise<TokenStore>
}): () => Promise<LocalGitHubConnection> {
  return async () => {
    const status = await deps.gh.getStatus()
    const store = await deps.store()
    const hasDeviceToken = Boolean(await store.get())

    if (status.kind === "authenticated") {
      return {
        tokenSource: "gh",
        gh: "authenticated",
        ghHandle: status.handle,
        hasDeviceToken,
      }
    }
    return {
      tokenSource: hasDeviceToken ? "device" : null,
      gh: status.kind,
      ghHandle: null,
      hasDeviceToken,
    }
  }
}

const productionConnectionReader = makeLocalGitHubConnectionReader({
  gh: makeGhCli(),
  store: getLocalTokenStore,
})

export function readLocalGitHubConnection(): Promise<LocalGitHubConnection> {
  return productionConnectionReader()
}
