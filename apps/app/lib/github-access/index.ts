import "server-only"

import { backendSwitch, buildIdentity } from "@/lib/capabilities"

import { createGhCliAccess, ghCliOf, GH_CLI_ID } from "./gh-cli"
import { createOAuthAccountAccess, OAUTH_ACCOUNT_ID } from "./oauth-account"
import type { GitHubAccess } from "./types"

export type { GitAccess, GitHubAccess, GitIdentity } from "./types"

/**
 * Pick this server's GitHub access: `GITHUB_ACCESS` when set, else
 * `oauth-account` when people sign in with GitHub (Hosted) and `gh-cli` when
 * the host is the only writer (the Mac app, Headless). A fork that needs
 * another implementation (a `gh` wrapper, GitHub Enterprise) changes this
 * function. Throws on an id it doesn't know.
 */
export function selectGitHubAccess(
  env: Record<string, string | undefined> = process.env
): GitHubAccess {
  const id =
    backendSwitch("GITHUB_ACCESS", env) ??
    (buildIdentity === "account" ? OAUTH_ACCOUNT_ID : GH_CLI_ID)
  switch (id) {
    case OAUTH_ACCOUNT_ID:
      return createOAuthAccountAccess()
    case GH_CLI_ID:
      return createGhCliAccess()
    default:
      throw new Error(
        `GITHUB_ACCESS "${id}" isn’t known (known: ${OAUTH_ACCOUNT_ID}, ${GH_CLI_ID})`
      )
  }
}

/** One per process, on `globalThis`, so every server bundle Next builds sees it. */
const KEY = Symbol.for("screenplay.githubAccess")
type Host = { [KEY]?: GitHubAccess }

function current(): GitHubAccess {
  return ((globalThis as Host)[KEY] ??= selectGitHubAccess())
}

/**
 * This server's GitHub access: every caller asks this, never the build or the
 * sandbox backend. Picked lazily, on first use, by {@link selectGitHubAccess}.
 */
export const githubAccess: GitHubAccess = {
  get id() {
    return current().id
  },
  get apiUrl() {
    return current().apiUrl
  },
  get webUrl() {
    return current().webUrl
  },
  apiToken: (userId) => current().apiToken(userId),
  get git() {
    return current().git
  },
}

/** The `gh` CLI behind this server's access, when it's `gh-cli`. */
export function hostGhCli() {
  return ghCliOf(current())
}
