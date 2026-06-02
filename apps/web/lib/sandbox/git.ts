"use server"

import { redactSensitiveInfo } from "@/lib/agent/redact"
import { getGitHubTokenForUser, getUserId } from "@/lib/auth-helpers"
import { createBranch, renameBranch } from "@/lib/github-actions"
import { isSandboxRunning, sandboxProvider } from "@/lib/sandbox"
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
  ghToken?: string,
): Promise<SandboxActionResult<void>> {
  const result = await createBranch(
    repo.repoOwner,
    repo.repoName,
    branchName,
    fromBranch || repo.defaultBranch,
    ghToken,
  )
  if (result.success) return { success: true, value: undefined }
  return { success: false, error: redactSensitiveInfo(result.error ?? "Failed to create branch") }
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
  newBranch: string,
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
    newBranch,
  )
  if (!remote.success) {
    // Branch doesn't exist on GitHub yet — fine, it'll be pushed with the new name.
    console.log(`GitHub branch rename skipped (${remote.error}), will push as ${newBranch}`)
  }

  return { success: true, value: undefined }
}

/**
 * Env vars to pass into a `sandbox.runCommand` that may hit GitHub. The
 * in-sandbox git credential helper reads SCREENPLAY_GH_TOKEN and echoes it as
 * HTTP basic auth — no server round-trip, no persistent creds in the sandbox,
 * attribution stays with whoever triggered this command.
 */
async function buildSandboxGitEnv(
  userId: string,
): Promise<Record<string, string> | undefined> {
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
  defaultBranch: string,
): Promise<{ additions: number; deletions: number } | null> {
  try {
    const sandbox = await sandboxProvider.get({ name: sandboxName, resume: false })
    if (!isSandboxRunning(sandbox)) return null

    // Try fetching silently — may fail on private repos without token, that's ok
    try {
      const actingUserId = await getUserId()
      const gitEnv = actingUserId ? await buildSandboxGitEnv(actingUserId) : undefined
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
 * can push commits. Auth is NOT baked into the remote URL — the per-command
 * credential helper installed here reads SCREENPLAY_GH_TOKEN from the env of
 * the command that invoked git, and the server attaches the acting user's token
 * per command. Each collaborator's pushes are attributed to them rather than to
 * whoever provisioned the sandbox.
 *
 * The credential helper is git infrastructure (not harness-specific), so it
 * lives here on the always-run git-setup path rather than riding along with a
 * harness install — git push works regardless of which harnesses (if any) the
 * operator selected.
 *
 * Only the remote-URL rewrite is load-bearing — if it fails the agent can't
 * push, so it runs through `step` (a non-zero exit becomes a redacted failure
 * result). The checkout / upstream / identity / credential-helper commands are
 * best-effort: a fresh branch has no `origin/<branch>` yet, so
 * `--set-upstream-to` routinely exits non-zero and that's fine. They run via
 * `runCommand` so their exit code is ignored, matching the pre-refactor behavior.
 */
export async function configureAgentGit(
  sandboxName: string,
  repo: RepoData,
  branch: string,
): Promise<SandboxActionResult<void>> {
  return runSandboxAction(sandboxName, async (sandbox) => {
    // Ensure we're on the actual branch, not a detached HEAD.
    // sandboxProvider.create with `revision` may check out the commit directly.
    await sandbox.runCommand("git", ["checkout", "-B", branch])
    await sandbox.runCommand("git", ["branch", "--set-upstream-to", `origin/${branch}`, branch])

    await step(sandbox, "git", [
      "remote",
      "set-url",
      "origin",
      `https://github.com/${repo.repoOwner}/${repo.repoName}.git`,
    ])

    await sandbox.runCommand("git", ["config", "user.email", "agent@screenplay.dev"])
    await sandbox.runCommand("git", ["config", "user.name", "Screenplay Agent"])
    await sandbox.runCommand("git", ["config", "push.default", "current"])

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
