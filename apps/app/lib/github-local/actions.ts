"use server"

import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

import { hasFixtureGitHub } from "@/lib/fixture-github"
import { getGitHubToken } from "@/lib/auth-helpers"
import { GITHUB_API_URL } from "@/lib/github-access/urls"
import { parseGitHubRemote } from "@/lib/github-local/parse-remote"
import {
  readLocalGitHubConnection,
  type GhConnectionState,
} from "@/lib/github-local/token-resolver"
import type { NewRepoSource } from "@/lib/github-local/types"
import { buildIdentity } from "@/lib/capabilities"

const execFileAsync = promisify(execFile)

/**
 * Server actions backing the local build's GitHub-connection and add-Repo
 * affordances (PRD #428). Every action no-ops with a clear error on the hosted
 * build — these surfaces are gated client-side to the local build, and the
 * guard keeps a stray call from ever touching host state on a server.
 */

const NOT_LOCAL = "This only works in the desktop app."

export interface GitHubLocalStatus {
  /** Whether the resolver is getting a token from `gh` (`null` = no API access). */
  tokenSource: "gh" | null
  /** The host `gh` CLI's install/auth state, so the UI can say "install"
   *  vs. "sign in" rather than only "connected / not". */
  gh: GhConnectionState
  /** The connected GitHub handle when `tokenSource === "gh"`, else `null`. */
  ghHandle: string | null
}

export async function getGitHubLocalStatus(): Promise<GitHubLocalStatus> {
  if (buildIdentity === "account") {
    return { tokenSource: null, gh: "not-installed", ghHandle: null }
  }
  if (await hasFixtureGitHub()) {
    return { tokenSource: "gh", gh: "authenticated", ghHandle: "designer" }
  }
  return readLocalGitHubConnection()
}

export type RepoSourceResult =
  { ok: true; source: NewRepoSource } | { ok: false; error: string }

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd })
  return stdout.trim()
}

/**
 * Inspect a local folder for the choose-a-local-folder entry point: reject
 * anything that isn't a git working tree up front (story 12 — fail at add
 * time, not provision time), and derive the Repo's identity from the clone
 * itself — `origin` remote → GitHub owner/name when it is one, the checked-out
 * default branch, the folder name as display name.
 */
export async function inspectLocalRepoPath(
  rawPath: string
): Promise<RepoSourceResult> {
  if (buildIdentity === "account") return { ok: false, error: NOT_LOCAL }
  const input = rawPath.trim()
  if (!input) return { ok: false, error: "Enter a folder path" }

  let repoRoot: string
  try {
    repoRoot = await git(["rev-parse", "--show-toplevel"], input)
  } catch {
    return { ok: false, error: `Not a git repository: ${input}` }
  }

  const originUrl = await git(
    ["config", "--get", "remote.origin.url"],
    repoRoot
  ).catch(() => "")
  const identity = originUrl ? parseGitHubRemote(originUrl) : null

  // The remote's default branch when the clone knows it, else whatever the
  // clone has checked out — for a local-path Repo that's the closest thing to
  // "the branch new work starts from".
  const defaultBranch =
    (await git(
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      repoRoot
    )
      .then((ref) => ref.replace(/^origin\//, ""))
      .catch(() => "")) ||
    (await git(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot).catch(
      () => "main"
    ))

  return {
    ok: true,
    source: {
      name: path.basename(repoRoot),
      repoFullName: identity
        ? `${identity.owner}/${identity.name}`
        : path.basename(repoRoot),
      repoOwner: identity?.owner ?? "",
      repoName: identity?.name ?? "",
      defaultBranch,
      cloneUrl: originUrl,
      localPath: repoRoot,
    },
  }
}

/**
 * Resolve a pasted clone URL for the add-by-URL entry point. A GitHub URL gets
 * its identity parsed out (and, when a token has resolved, its real default
 * branch from the API); any other URL still works through the no-auth floor —
 * it just defaults the branch and carries no GitHub identity.
 */
export async function resolveRepoFromUrl(
  rawUrl: string
): Promise<RepoSourceResult> {
  if (buildIdentity === "account") return { ok: false, error: NOT_LOCAL }
  const url = rawUrl.trim()
  if (!url) return { ok: false, error: "Enter a clone URL" }

  const identity = parseGitHubRemote(url)
  let defaultBranch = "main"

  if (identity) {
    const token = await getGitHubToken()
    if (token) {
      try {
        const res = await fetch(
          `${GITHUB_API_URL}/repos/${identity.owner}/${identity.name}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
            },
          }
        )
        if (res.ok) {
          const data = (await res.json()) as { default_branch?: string }
          if (data.default_branch) defaultBranch = data.default_branch
        }
      } catch {
        // Offline or API hiccup — keep the fallback; provisioning resolves the
        // real branch against the clone anyway.
      }
    }
  }

  const lastSegment = url
    .replace(/\/+$/, "")
    .split(/[/:]/)
    .pop()
    ?.replace(/\.git$/, "")

  return {
    ok: true,
    source: {
      name: identity?.name ?? lastSegment ?? url,
      repoFullName: identity
        ? `${identity.owner}/${identity.name}`
        : (lastSegment ?? url),
      repoOwner: identity?.owner ?? "",
      repoName: identity?.name ?? "",
      defaultBranch,
      cloneUrl: url,
    },
  }
}
