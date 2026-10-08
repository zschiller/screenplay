import "server-only"

import {
  makeGhCli,
  type GhCli,
  type GhProcessRunner,
} from "@/lib/github-local/gh-cli"

import type { GitHubAccess } from "./types"
import { GITHUB_DOT_COM_URLS } from "./urls"

export const GH_CLI_ID = "gh-cli"

/**
 * The `gh-cli` built-in: the Mac app and Headless, on github.com. The token is
 * whatever `gh auth token` prints, for every person (one host, one login). Git
 * is the host's own: credentials and identity come from the machine's git
 * config, so commits are the host's.
 */
export function createGhCliAccess(run?: GhProcessRunner): GitHubAccess {
  const cli = makeGhCli(run)
  const access: GitHubAccess = {
    id: GH_CLI_ID,
    ...GITHUB_DOT_COM_URLS,
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
