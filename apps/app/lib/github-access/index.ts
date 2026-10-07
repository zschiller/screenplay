import "server-only"

import { buildIdentity } from "@/lib/capabilities"

import { createGhCliAccess, ghCliOf, GH_CLI_ID } from "./gh-cli"
import { createOAuthAccountAccess, OAUTH_ACCOUNT_ID } from "./oauth-account"
import type { GitHubAccess, GitHubAccessFactory } from "./types"

export type {
  GitAccess,
  GitHubAccess,
  GitHubAccessFactory,
  GitIdentity,
} from "./types"

/** The built-in implementations, by the id config names them with. */
export const BUILT_IN_GITHUB_ACCESS: Readonly<
  Record<string, GitHubAccessFactory>
> = {
  [OAUTH_ACCOUNT_ID]: createOAuthAccountAccess,
  [GH_CLI_ID]: (options) => createGhCliAccess(options),
}

/** A config entry: `{ use: <id>, …options }`. */
export interface GitHubAccessChoice {
  use: string
  [option: string]: unknown
}

/**
 * The choice when config names none: `oauth-account` when people sign in with
 * GitHub (Hosted), `gh-cli` with its defaults when the host is the only writer
 * (the Mac app, Headless).
 */
export function defaultGitHubAccessChoice(): GitHubAccessChoice {
  return { use: buildIdentity === "account" ? OAUTH_ACCOUNT_ID : GH_CLI_ID }
}

/**
 * Build the implementation a config entry picks. Throws when the id is unknown
 * or its options are wrong, so the server refuses to start with that message.
 */
export function selectGitHubAccess(
  choice: GitHubAccessChoice,
  factories: Readonly<
    Record<string, GitHubAccessFactory>
  > = BUILT_IN_GITHUB_ACCESS
): GitHubAccess {
  const factory = factories[choice.use]
  if (!factory) {
    throw new Error(
      `GitHub access "${choice.use}" isn’t known (known: ${Object.keys(
        factories
      ).join(", ")})`
    )
  }
  const { use: _use, ...options } = choice
  return factory(options)
}

/**
 * This server's GitHub access. A single read at module load, like the sandbox
 * provider: every caller asks this, never the build or the sandbox backend.
 */
export const githubAccess: GitHubAccess = selectGitHubAccess(
  defaultGitHubAccessChoice()
)

/** The `gh` CLI behind this server's access, when it's `gh-cli`. */
export function hostGhCli() {
  return ghCliOf(githubAccess)
}
