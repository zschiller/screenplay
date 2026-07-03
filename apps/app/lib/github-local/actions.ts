"use server"

import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

import {
  awaitDeviceAuthorization,
  fetchDeviceFlowTransport,
  requestDeviceCode,
  type DeviceAuthorization,
  type DeviceFlowOutcome,
} from "@/lib/github-local/device-flow"
import { parseGitHubRemote } from "@/lib/github-local/parse-remote"
import { getLocalTokenStore } from "@/lib/github-local/token-store"
import {
  readLocalGitHubConnection,
  resolveLocalGitHubToken,
  type GhConnectionState,
} from "@/lib/github-local/token-resolver"
import type { NewRepoSource } from "@/lib/github-local/types"
import { isLocalBuild } from "@/lib/local-mode"

const execFileAsync = promisify(execFile)

/**
 * Server actions backing the local build's GitHub-connection and add-Repo
 * affordances (PRD #428). Every action no-ops with a clear error on the hosted
 * build — these surfaces are gated client-side to the local build, and the
 * guard keeps a stray call from ever touching host state on a server.
 */

const NOT_LOCAL = "Only available on the local desktop build"

export interface GitHubLocalStatus {
  /** Where the resolver is currently getting a token (`null` = no API access). */
  tokenSource: "gh" | "device" | null
  /** The host `gh` CLI's install/auth state, so the UI can say "install"
   *  vs. "sign in" rather than only "connected / not". */
  gh: GhConnectionState
  /** The connected GitHub handle when `tokenSource === "gh"`, else `null`. */
  ghHandle: string | null
  /**
   * Whether a device-flow token exists at all — reported separately from
   * `tokenSource` because the resolver prefers `gh`, so a dormant device token
   * can sit under a `gh` connection (ADR 0014).
   */
  hasDeviceToken: boolean
  /** Whether the GitHub App client id for the device flow is configured. */
  deviceFlowConfigured: boolean
}

export async function getGitHubLocalStatus(): Promise<GitHubLocalStatus> {
  if (!isLocalBuild) {
    return {
      tokenSource: null,
      gh: "not-installed",
      ghHandle: null,
      hasDeviceToken: false,
      deviceFlowConfigured: false,
    }
  }
  const connection = await readLocalGitHubConnection()
  return {
    ...connection,
    deviceFlowConfigured: Boolean(process.env.SCREENPLAY_GITHUB_CLIENT_ID),
  }
}

export type BeginDeviceFlowResult =
  | { ok: true; grant: DeviceAuthorization }
  | { ok: false; error: string }

/**
 * Start a device-flow login: returns the user code + verification URL for the
 * UI to surface, plus the full grant the client hands back to
 * {@link completeGitHubDeviceFlow}.
 */
export async function beginGitHubDeviceFlow(): Promise<BeginDeviceFlowResult> {
  if (!isLocalBuild) return { ok: false, error: NOT_LOCAL }
  const clientId = process.env.SCREENPLAY_GITHUB_CLIENT_ID
  if (!clientId) {
    return {
      ok: false,
      error:
        "GitHub connect isn't configured (SCREENPLAY_GITHUB_CLIENT_ID is unset)",
    }
  }
  try {
    const grant = await requestDeviceCode(fetchDeviceFlowTransport, {
      clientId,
      scopes: ["repo"],
    })
    return { ok: true, grant }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Drive the poll loop for a grant from {@link beginGitHubDeviceFlow} to its
 * terminal outcome, storing the token on success. The sidecar is a long-lived
 * host Node server (no serverless timeout), so holding this action open for
 * the authorize wait is fine; the codes expire after ~15 minutes regardless.
 */
export async function completeGitHubDeviceFlow(
  grant: DeviceAuthorization
): Promise<DeviceFlowOutcome> {
  if (!isLocalBuild) return { status: "error", message: NOT_LOCAL }
  const clientId = process.env.SCREENPLAY_GITHUB_CLIENT_ID
  if (!clientId) {
    return { status: "error", message: "SCREENPLAY_GITHUB_CLIENT_ID is unset" }
  }
  const outcome = await awaitDeviceAuthorization(fetchDeviceFlowTransport, {
    clientId,
    grant,
    sleep: (seconds) => new Promise((r) => setTimeout(r, seconds * 1000)),
  })
  if (outcome.status === "authorized") {
    const store = await getLocalTokenStore()
    await store.set(outcome.token)
    // Never hand the raw token to the browser — the client only needs the
    // outcome; API calls resolve the token server-side through the seam.
    return { status: "authorized", token: "", scopes: outcome.scopes }
  }
  return outcome
}

/** Clear the stored device-flow token (story 17). A `gh` login, if present,
 *  still resolves — disconnect only severs what the app itself stored. */
export async function disconnectGitHub(): Promise<void> {
  if (!isLocalBuild) return
  const store = await getLocalTokenStore()
  await store.clear()
}

export type RepoSourceResult =
  | { ok: true; source: NewRepoSource }
  | { ok: false; error: string }

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
  if (!isLocalBuild) return { ok: false, error: NOT_LOCAL }
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
  if (!isLocalBuild) return { ok: false, error: NOT_LOCAL }
  const url = rawUrl.trim()
  if (!url) return { ok: false, error: "Enter a clone URL" }

  const identity = parseGitHubRemote(url)
  let defaultBranch = "main"

  if (identity) {
    const token = await resolveLocalGitHubToken()
    if (token) {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${identity.owner}/${identity.name}`,
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
