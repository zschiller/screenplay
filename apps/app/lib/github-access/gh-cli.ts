import "server-only"

import {
  makeGhCli,
  type GhCli,
  type GhProcessRunner,
} from "@/lib/github-local/gh-cli"

import {
  optionArgv,
  optionString,
  optionUrl,
  rejectUnknownOptions,
} from "./options"
import type { GitHubAccess } from "./types"
import { GITHUB_DOT_COM, githubUrlsForHostname } from "./urls"

export const GH_CLI_ID = "gh-cli"

/**
 * The `gh-cli` built-in: the Mac app today, and a company box through its
 * options. The token is whatever `<command> auth token` prints, for every
 * person (one host, one login). Git is the host's own: credentials and
 * identity come from the machine's git config, so commits are the host's.
 *
 * Options:
 * - `command`: argv prefix that stands in for `gh`, e.g. `"corp-gh"`.
 * - `hostname`: the GitHub host, for GitHub Enterprise. Adds `--hostname`.
 * - `apiUrl` / `webUrl`: override what the hostname derives (rarely needed).
 */
export function createGhCliAccess(
  options: Record<string, unknown>,
  run?: GhProcessRunner
): GitHubAccess {
  rejectUnknownOptions(GH_CLI_ID, options, [
    "command",
    "hostname",
    "apiUrl",
    "webUrl",
  ])
  const command = optionArgv(GH_CLI_ID, options, "command")
  const hostname = optionString(GH_CLI_ID, options, "hostname")
  const derived = githubUrlsForHostname(hostname ?? GITHUB_DOT_COM)
  const cli = makeGhCli(run, { command, hostname })
  const access: GitHubAccess = {
    id: GH_CLI_ID,
    apiUrl: optionUrl(GH_CLI_ID, options, "apiUrl") ?? derived.apiUrl,
    webUrl: optionUrl(GH_CLI_ID, options, "webUrl") ?? derived.webUrl,
    apiToken: () => cli.getToken(),
    git: { kind: "host" },
  }
  ghClis.set(access, cli)
  return access
}

const ghClis = new WeakMap<GitHubAccess, GhCli>()

/**
 * The CLI behind a `gh-cli` access, for the Mac app's connection row and
 * first-run gate, which ask about the binary itself (installed, signed in, the
 * handle). Not part of the interface: other implementations have no CLI.
 */
export function ghCliOf(access: GitHubAccess): GhCli | null {
  return ghClis.get(access) ?? null
}
