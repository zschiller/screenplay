import "server-only"

import type { SandboxInstance } from "@/lib/sandbox/types"
import { step } from "@/lib/sandbox/run"
import type { RepoData } from "@/lib/types"

/** A git author/committer identity — the `Name <email>` stamped onto a commit. */
export interface GitIdentity {
  name: string
  email: string
}

/**
 * Everything GitHub work needs for one person, answered in one place: their API
 * token, the credentials git uses to talk to origin, and the identity their
 * commits carry. Callers ask this instead of branching on the build or the
 * Sandbox backend.
 *
 *  - **brokered** (hosted): the server holds each person's OAuth token and hands
 *    it, with their author/committer identity, to every git command that needs
 *    it. Nothing is persisted in the Sandbox, so collaborators sharing one push
 *    and commit as themselves (ADR 0002).
 *  - **host** (desktop): git runs as a host process and uses the host's own
 *    credentials (credential helper / SSH / `gh`) and git config. The API token
 *    is the `gh` CLI's (ADR 0018). Nothing is brokered per command.
 *
 * One adapter is picked once at startup (`@/lib/github-access`).
 */
export interface GitHubAccess {
  readonly kind: "brokered" | "host"
  /**
   * Whether GitHub work can't start without an API token: on brokered,
   * branches are created through the API and clones are token-authed; on host,
   * git rides host auth and a missing token only darkens the API features.
   */
  readonly requiresToken: boolean
  /** The person's API token (repo list, PRs, naming), or null. */
  token(userId: string): Promise<string | null>
  /** Env for one git command that talks to origin as this person. */
  transportEnv(userId: string): Promise<Record<string, string> | undefined>
  /** The identity this person's commits carry, or null when git config decides. */
  identity(userId: string): Promise<GitIdentity | null>
  /** {@link transportEnv} plus author/committer env for this person. */
  commitEnv(userId: string): Promise<Record<string, string> | undefined>
  /** Credentials to splice into a clone, or undefined for a plain clone. */
  cloneCredentials(
    token: string | undefined
  ): { username: string; password: string } | undefined
  /**
   * Make a fresh checkout able to push as whoever drives it. `userId` is the
   * person provisioning it, or null when unknown.
   */
  prepareCheckout(
    sandbox: SandboxInstance,
    repo: RepoData,
    userId: string | null
  ): Promise<void>
}

function identityEnv(identity: GitIdentity): Record<string, string> {
  return {
    GIT_AUTHOR_NAME: identity.name,
    GIT_AUTHOR_EMAIL: identity.email,
    GIT_COMMITTER_NAME: identity.name,
    GIT_COMMITTER_EMAIL: identity.email,
  }
}

/**
 * The hosted adapter. `token` and `identity` look the person up (Better Auth's
 * `account` row, the `user` row).
 */
export function createBrokeredGitHubAccess(lookup: {
  token: (userId: string) => Promise<string | null>
  identity: (userId: string) => Promise<GitIdentity | null>
}): GitHubAccess {
  const transportEnv = async (userId: string) => {
    const token = await lookup.token(userId)
    return token ? { SCREENPLAY_GH_TOKEN: token } : undefined
  }
  return {
    kind: "brokered",
    requiresToken: true,
    token: lookup.token,
    identity: lookup.identity,
    transportEnv,
    async commitEnv(userId) {
      const [transport, identity] = await Promise.all([
        transportEnv(userId),
        lookup.identity(userId),
      ])
      const env = {
        ...transport,
        ...(identity ? identityEnv(identity) : {}),
      }
      return Object.keys(env).length > 0 ? env : undefined
    },
    cloneCredentials(token) {
      return token ? { username: "x-access-token", password: token } : undefined
    },
    async prepareCheckout(sandbox, repo, userId) {
      // Static author net: stamp the *provisioning* person's real identity —
      // never a fabricated address. A shared hosted sandbox has no single
      // author, so `commitEnv` layers GIT_AUTHOR_*/GIT_COMMITTER_* on top per
      // command, attributing each commit to whoever drove it. This stamp only
      // covers commits made outside that path; with no person we set no
      // identity rather than invent one.
      const identity = userId ? await lookup.identity(userId) : null
      if (identity) {
        await sandbox.runCommand("git", [
          "config",
          "user.email",
          identity.email,
        ])
        await sandbox.runCommand("git", ["config", "user.name", identity.name])
      }
      await sandbox.runCommand("git", ["config", "push.default", "current"])

      // Auth is NOT baked into the remote URL. The one load-bearing step: if
      // it fails the agent can't push, so it runs through `step`.
      await step(sandbox, "git", [
        "remote",
        "set-url",
        "origin",
        `https://github.com/${repo.repoOwner}/${repo.repoName}.git`,
      ])

      // Per-command credential helper: git invokes it whenever it needs GitHub
      // auth, and it reads SCREENPLAY_GH_TOKEN from the env the server set on
      // the triggering runCommand (`transportEnv`). No token is persisted in
      // the sandbox, so two people sharing it push as themselves. It is git
      // infrastructure, not harness-specific, so it installs whichever
      // harnesses run. The home dir is provider-supplied.
      const { homeDir } = sandbox
      const credentialHelper = [
        "#!/bin/sh",
        `[ "\${1:-}" = "get" ] || exit 0`,
        "cat >/dev/null",
        `[ -n "\${SCREENPLAY_GH_TOKEN:-}" ] || exit 0`,
        `printf 'username=x-access-token\\npassword=%s\\n' "$SCREENPLAY_GH_TOKEN"`,
        "",
      ].join("\n")
      await sandbox.runCommand({
        cmd: "sh",
        args: [
          "-c",
          `mkdir -p "${homeDir}/.screenplay" && printf '%s' "$HELPER" > "${homeDir}/.screenplay/git-credential-helper.sh" && chmod +x "${homeDir}/.screenplay/git-credential-helper.sh" && git config --global credential.helper "${homeDir}/.screenplay/git-credential-helper.sh" && git config --global credential.useHttpPath false`,
        ],
        env: { HELPER: credentialHelper },
      })
    },
  }
}

/**
 * The desktop adapter. `token` resolves the host `gh` CLI's token (the local
 * token resolver); git needs nothing from us.
 */
export function createHostGitHubAccess(lookup: {
  token: (userId: string) => Promise<string | null>
}): GitHubAccess {
  return {
    kind: "host",
    requiresToken: false,
    token: lookup.token,
    transportEnv: async () => undefined,
    identity: async () => null,
    commitEnv: async () => undefined,
    cloneCredentials: () => undefined,
    // The checkout shares the person's own `.git` (for a `local-path` Repo it
    // *is* their repo), and `origin` already points at their remote, possibly
    // SSH. So nothing is stamped: a plain `git config` writes to the shared
    // `.git/config` and would clobber their identity for the whole repo, and a
    // remote rewrite would clobber their SSH remote.
    prepareCheckout: async () => {},
  }
}
