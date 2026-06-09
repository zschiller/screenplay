import "server-only"

import { makeGhCli, type GhCli } from "@/lib/github-local/gh-cli"
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
  gh: GhCli
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

/**
 * Which source is currently supplying the token, for the connect/disconnect
 * affordances: `"gh"` outranks a stored device-flow token (mirroring the
 * resolver), `null` means no GitHub API access.
 */
export async function getLocalGitHubTokenSource(): Promise<
  "gh" | "device" | null
> {
  if (await makeGhCli().getToken()) return "gh"
  const store = await getLocalTokenStore()
  return (await store.get()) ? "device" : null
}
