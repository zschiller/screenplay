"use server"

import { redactSensitiveInfo } from "@/lib/agent/redact"
import {
  getGitHubTokenForUser,
  getGitIdentityForUser,
  getUserId,
} from "@/lib/auth-helpers"
import { createBranch, renameBranch } from "@/lib/github-actions"
import {
  isSandboxRunning,
  sandboxProvider,
  usesHostGitAuth,
} from "@/lib/sandbox"
import { runSandboxAction, step } from "@/lib/sandbox/run"
import type { SandboxActionResult } from "@/lib/sandbox/run"
import type { RepoData } from "@/lib/types"

/**
 * Create a Git branch on GitHub for the agent. This is a pure GitHub API call —
 * it never touches a sandbox — so it doesn't go through `runSandboxAction`, but
 * it adopts the same uniform result contract (and redacts the error on the way
 * out) so every git action surfaces failure the same way to callers.
 */
export async function createAgentBranch(
  repo: RepoData,
  branchName: string,
  fromBranch?: string,
  ghToken?: string
): Promise<SandboxActionResult<void>> {
  const result = await createBranch(
    repo.repoOwner,
    repo.repoName,
    branchName,
    fromBranch || repo.defaultBranch,
    ghToken
  )
  if (result.success) return { success: true, value: undefined }
  return {
    success: false,
    error: redactSensitiveInfo(result.error ?? "Failed to create branch"),
  }
}

/**
 * Rename a branch in the sandbox and on GitHub (if it exists remotely). The
 * in-sandbox rename is load-bearing (it runs through `step`, so a non-zero exit
 * becomes a redacted failure result); the GitHub rename is best-effort — a
 * branch that hasn't been pushed yet simply doesn't exist remotely and will be
 * pushed under the new name later.
 */
export async function renameAgentBranch(
  repo: RepoData,
  sandboxName: string,
  oldBranch: string,
  newBranch: string
): Promise<SandboxActionResult<void>> {
  const local = await runSandboxAction(sandboxName, async (sandbox) => {
    await step(sandbox, "git", ["branch", "-m", newBranch])
  })
  if (!local.success) return local

  // Attempt GitHub rename — may not exist remotely yet (e.g. forked sandboxes).
  const remote = await renameBranch(
    repo.repoOwner,
    repo.repoName,
    oldBranch,
    newBranch
  )
  if (!remote.success) {
    // Branch doesn't exist on GitHub yet — fine, it'll be pushed with the new name.
    console.log(
      `GitHub branch rename skipped (${remote.error}), will push as ${newBranch}`
    )
  }

  return { success: true, value: undefined }
}

/**
 * Env vars to pass into a `sandbox.runCommand` that may hit GitHub. The
 * in-sandbox git credential helper reads SCREENPLAY_GH_TOKEN and echoes it as
 * HTTP basic auth — no server round-trip, no persistent creds in the sandbox,
 * attribution stays with whoever triggered this command.
 *
 * On the local backend this is a no-op: git runs as a host process and
 * authenticates through the user's own credentials (credential helper / SSH /
 * `gh`), so there is no token to broker per command.
 */
async function buildSandboxGitEnv(
  userId: string
): Promise<Record<string, string> | undefined> {
  if (usesHostGitAuth) return undefined
  const token = await getGitHubTokenForUser(userId)
  if (!token) return undefined
  return { SCREENPLAY_GH_TOKEN: token }
}

/**
 * Get line-level diff stats (additions/deletions) for a sandbox branch compared
 * to the default branch. Uses the local origin ref to avoid needing auth for a
 * fresh fetch. A pure query: it returns a plain value (or `null` on any
 * failure), not the command-result contract.
 */
export async function getDiffStats(
  sandboxName: string,
  defaultBranch: string
): Promise<{ additions: number; deletions: number } | null> {
  try {
    const sandbox = await sandboxProvider.get({
      name: sandboxName,
      resume: false,
    })
    if (!isSandboxRunning(sandbox)) return null

    // Try fetching silently — may fail on private repos without token, that's ok
    try {
      const actingUserId = await getUserId()
      const gitEnv = actingUserId
        ? await buildSandboxGitEnv(actingUserId)
        : undefined
      await sandbox.runCommand({
        cmd: "git",
        args: ["fetch", "origin", defaultBranch, "--quiet"],
        ...(gitEnv ? { env: gitEnv } : {}),
      })
    } catch {}

    // Use numstat for reliable machine-parseable output
    const result = await sandbox.runCommand("git", [
      "diff",
      "--numstat",
      `origin/${defaultBranch}`,
    ])
    const stdout = (await result.stdout()).trim()
    if (!stdout) return { additions: 0, deletions: 0 }

    let additions = 0
    let deletions = 0
    for (const line of stdout.split("\n")) {
      const [add, del] = line.split("\t")
      // Binary files show "-" for add/del
      if (add !== "-") additions += parseInt(add, 10) || 0
      if (del !== "-") deletions += parseInt(del, 10) || 0
    }

    return { additions, deletions }
  } catch {
    return null
  }
}

/**
 * Configure git identity and normalize the branch / remote state so the agent
 * can push commits.
 *
 * **Auth depends on the backend.** On the hosted Vercel backend, auth is NOT
 * baked into the remote URL — the per-command credential helper installed here
 * reads SCREENPLAY_GH_TOKEN from the env of the command that invoked git, and
 * the server attaches the acting user's token per command, so each
 * collaborator's pushes are attributed to them rather than to whoever
 * provisioned the sandbox. The credential helper is git infrastructure (not
 * harness-specific), so it lives here on the always-run git-setup path rather
 * than riding along with a harness install — git push works regardless of which
 * harnesses (if any) the operator selected.
 *
 * **Commit authorship is brokered the same way, not stamped statically.** The
 * `user.email`/`user.name` set here is only a fallback net seeded with the
 * *triggering* user's real identity — never a fabricated address. Per-command,
 * `buildAgentGitEnv` attaches the acting user's `GIT_AUTHOR_*` / `GIT_COMMITTER_*`
 * (parallel to the token), so commits in a shared sandbox attribute to whoever
 * drove them, overriding this fallback. There is no synthetic agent identity.
 *
 * On the local backend (`usesHostGitAuth`), none of that brokering
 * applies: git runs as a host process and authenticates through the user's own
 * credentials (credential helper / SSH / `gh`). So we neither rewrite `origin`
 * to a canonical HTTPS URL (which would clobber a user's SSH remote) nor install
 * the SCREENPLAY_GH_TOKEN helper — the host's native auth already covers
 * clone / fetch / push. We also skip the identity / `push.default` stamp: a
 * plain `git config` would write to the shared `.git/config` (the user's own
 * repo for a `local-path` Repo), clobbering the identity they've set for their
 * entire repo. The host's own git identity is already correct. Only branch
 * normalization (`checkout` / upstream) runs on both paths.
 *
 * On the hosted path the remote-URL rewrite is the one load-bearing step — if it
 * fails the agent can't push, so it runs through `step` (a non-zero exit becomes
 * a redacted failure result). The checkout / upstream / identity commands are
 * best-effort: a fresh branch has no `origin/<branch>` yet, so
 * `--set-upstream-to` routinely exits non-zero and that's fine. They run via
 * `runCommand` so their exit code is ignored, matching the pre-refactor behavior.
 */
export async function configureAgentGit(
  sandboxName: string,
  repo: RepoData,
  branch: string
): Promise<SandboxActionResult<void>> {
  return runSandboxAction(sandboxName, async (sandbox) => {
    // Ensure we're on the actual branch, not a detached HEAD.
    // sandboxProvider.create with `revision` may check out the commit directly.
    await sandbox.runCommand("git", ["checkout", "-B", branch])
    await sandbox.runCommand("git", [
      "branch",
      "--set-upstream-to",
      `origin/${branch}`,
      branch,
    ])

    // Local backend: the worktree shares the user's own `.git` (for a
    // `local-path` Repo it *is* the user's repo), git authenticates and pushes
    // through the user's host credentials, and `origin` already points at their
    // remote (possibly SSH). So everything below is hosted-only:
    //   - Identity (`user.email`/`user.name`) and `push.default` must NOT run
    //     here. Plain `git config` writes to the shared `.git/config`, not the
    //     worktree, so stamping the agent identity would clobber the user's own
    //     identity for their entire repo and relabel their commits as the agent.
    //     On local the host's native git identity is already correct.
    //   - The remote rewrite and brokered-token helper belong to the hosted
    //     firewall trust boundary (ADR 0002), which doesn't exist here.
    if (usesHostGitAuth) return

    // Static author net: stamp the *triggering* user's real identity — never a
    // fabricated address. A shared hosted sandbox has no single author, so the
    // per-command broker (`buildAgentGitEnv`) layers GIT_AUTHOR_*/GIT_COMMITTER_*
    // on top, attributing each commit to whichever collaborator drove it and
    // overriding this config. This stamp only covers commits made outside that
    // brokered path; if the user can't be resolved we set no identity rather
    // than invent one.
    const actingUserId = await getUserId()
    const identity = actingUserId
      ? await getGitIdentityForUser(actingUserId)
      : null
    if (identity) {
      await sandbox.runCommand("git", ["config", "user.email", identity.email])
      await sandbox.runCommand("git", ["config", "user.name", identity.name])
    }
    await sandbox.runCommand("git", ["config", "push.default", "current"])

    await step(sandbox, "git", [
      "remote",
      "set-url",
      "origin",
      `https://github.com/${repo.repoOwner}/${repo.repoName}.git`,
    ])

    // Per-command credential helper: git invokes it whenever it needs GitHub
    // auth, and it reads SCREENPLAY_GH_TOKEN from the env the server set on the
    // triggering runCommand. No token is persisted in the sandbox — every
    // command brings its own, so two users sharing this sandbox correctly push
    // as themselves rather than riding on whoever provisioned it first. The
    // home dir is provider-supplied so the helper follows the actual layout.
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
  })
}
