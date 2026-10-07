"use server"

import { redactSensitiveInfo } from "@/lib/agent/redact"
import { getUserId } from "@/lib/auth-helpers"
import type { UnsavedWork } from "@/lib/branch/unsaved-work"
import { fixtureUnsavedWork } from "@/lib/fixture-git"
import { isFixtureWorld } from "@/lib/fixture-world"
import { githubAccess } from "@/lib/github-access"
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
    error: redactSensitiveInfo(result.error ?? "Couldn’t set up the code."),
  }
}

/**
 * Rename a branch in the sandbox and on GitHub (if it exists remotely). The
 * in-sandbox rename is load-bearing (it runs through `step`, so a non-zero exit
 * becomes a redacted failure result); the GitHub rename is best-effort — a
 * branch that hasn't been pushed yet simply doesn't exist remotely and will be
 * pushed under the new name later. `ghToken` lets a caller outside a request
 * (the server's auto-naming, #910) act as the user who sent the turn.
 */
export async function renameAgentBranch(
  repo: RepoData,
  sandboxName: string,
  oldBranch: string,
  newBranch: string,
  ghToken?: string
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
    ghToken
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
        ? await githubAccess.transportEnv(actingUserId)
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
 * Read what a Workspace's checkout holds that git hasn't saved elsewhere:
 * whether its branch is on origin, how many commits origin lacks, and how many
 * files are uncommitted (issue #776). The delete confirms show it so a warning
 * appears only when it's true.
 *
 * It reads the local `origin/*` refs without fetching, so it answers at once;
 * those refs move with every push the app makes. A pure query like
 * {@link getDiffStats}: `null` when the Sandbox isn't running or any read
 * fails, which the dialogs treat as "unknown" and claim nothing about.
 */
export async function getUnsavedWork(
  sandboxName: string,
  ref: string,
  defaultBranch: string
): Promise<UnsavedWork | null> {
  // A capture has no real checkouts; it reads the canned ones instead.
  if (isFixtureWorld) return fixtureUnsavedWork(sandboxName)
  if (!sandboxName || !ref) return null
  try {
    const sandbox = await sandboxProvider.get({
      name: sandboxName,
      resume: false,
    })
    if (!isSandboxRunning(sandbox)) return null

    const git = async (args: string[]) => {
      const result = await sandbox.runCommand("git", args)
      return { ok: result.exitCode === 0, out: (await result.stdout()).trim() }
    }
    const remoteRef = `refs/remotes/origin/${ref}`
    const onOrigin = (
      await git(["rev-parse", "--verify", "--quiet", remoteRef])
    ).ok
    // A branch that was never pushed has all its own commits to lose: count
    // them from where it left the default branch.
    const base = onOrigin ? remoteRef : `refs/remotes/origin/${defaultBranch}`
    const [count, status] = await Promise.all([
      git(["rev-list", "--count", `${base}..HEAD`]),
      git(["status", "--porcelain"]),
    ])
    if (!count.ok || !status.ok) return null

    return {
      onOrigin,
      unpushedCommits: parseInt(count.out, 10) || 0,
      uncommittedFiles: status.out ? status.out.split("\n").length : 0,
    }
  } catch {
    return null
  }
}

/**
 * Normalize the branch / remote state and make the checkout able to push.
 *
 * Branch normalization (`checkout` / upstream) is the same everywhere. How git
 * authenticates and whose identity commits carry is the GitHub access
 * adapter's call (`prepareCheckout`): on hosted it rewrites `origin` to the
 * canonical HTTPS URL, installs the per-command credential helper and stamps
 * the provisioning person's identity as a fallback; on the desktop the host's
 * own git config and credentials already cover it, so nothing is touched.
 *
 * The checkout / upstream commands are best-effort: a fresh branch has no
 * `origin/<branch>` yet, so `--set-upstream-to` routinely exits non-zero and
 * that's fine. They run via `runCommand` so their exit code is ignored; a
 * load-bearing adapter step that fails becomes a redacted failure result.
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
    await githubAccess.prepareCheckout(sandbox, repo, await getUserId())
  })
}
