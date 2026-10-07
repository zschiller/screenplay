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

/** One per process, on `globalThis`, so every server bundle Next builds sees it. */
const KEY = Symbol.for("screenplay.githubAccess")
type Host = { [KEY]?: GitHubAccess }

function current(): GitHubAccess {
  return ((globalThis as Host)[KEY] ??= selectGitHubAccess(
    defaultGitHubAccessChoice()
  ))
}

/**
 * Pick this server's GitHub access, once, as the server starts: what the
 * config file names (`lib/extensions/apply.ts`). Unset, it's the default
 * choice above.
 */
export function setGitHubAccess(access: GitHubAccess): void {
  ;(globalThis as Host)[KEY] = access
}

/**
 * This server's GitHub access: every caller asks this, never the build or the
 * sandbox backend. Each member reads whatever the server picked at start.
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
