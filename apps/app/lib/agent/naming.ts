import "server-only"

import { getGitHubTokenForUser } from "@/lib/auth-helpers"
import { GITHUB_API_URL } from "@/lib/github-access/urls"
import type { RoomReader } from "@/lib/room-access"
import { sanitizeBranchName } from "@/lib/branch-rename"
import { deriveFallbackName } from "./fallback-name"
import { runOneShotModel } from "./one-shot-model"

/**
 * Generate a git branch name, a chat label and a Workspace title from the
 * user's first message.
 * Mirrors the v1 stream route's behavior (one cheap LLM call, two-line output),
 * routed through {@link runOneShotModel}: hosted shells the configured API-key
 * provider unchanged, desktop shells the user's own installed harness CLI in
 * print mode (`claude -p`, #674). On no model / a failed call the transport
 * returns `null` and we fall back to the improved deterministic slug (#675) —
 * naming never blocks Workspace creation.
 *
 * The Workspace title is the chat label (#881): the first chat names its
 * Workspace, so one line of the same call serves both. It is only returned
 * alongside a branch name — a later chat (`shouldNameBranch=false`) never
 * retitles its Workspace.
 *
 * Returns `{ branch: "", title: "" }` if naming is skipped (`shouldNameBranch=false`).
 */
export async function generateChatNames(
  opts: {
    message: string
    shouldNameBranch: boolean
    /** Provider:model id used for the hosted naming call. Defaults to DEFAULT_MODEL. */
    model?: string
  },
  /** Injected for tests; defaults to the real per-backend transport. */
  deps: { runModel?: typeof runOneShotModel } = {}
): Promise<{ branch: string; chatLabel: string; title: string }> {
  const runModel = deps.runModel ?? runOneShotModel
  const system = opts.shouldNameBranch
    ? "Generate two things for the user’s request:\n1. A short, lowercase, hyphenated git branch name (2-4 words)\n2. A short chat label (2-5 words, sentence case)\n\nOutput ONLY as two lines, no explanation, backticks, or quotes.\nLine 1: branch name\nLine 2: chat label\n\nExamples:\nfix-login-button\nFix login button\n\nadd-dark-mode\nAdd dark mode"
    : "Generate a short chat label for the user’s request (2-5 words, sentence case). Output ONLY the label — no explanation, backticks, or quotes.\n\nExamples:\nFix login button\nAdd dark mode"

  const rawText = await runModel({
    system,
    prompt: opts.message,
    model: opts.model,
  })

  if (rawText === null) {
    // No-model fallback: derive a tidy deterministic branch/label from the
    // prompt. The branch is only offered when a branch name was wanted;
    // otherwise we leave it blank so the caller keeps the existing branch.
    const fallback = deriveFallbackName(opts.message)
    return {
      branch: opts.shouldNameBranch ? fallback.branch : "",
      chatLabel: fallback.label,
      title: opts.shouldNameBranch ? fallback.label : "",
    }
  }

  const lines = rawText
    .split("\n")
    .map((l) =>
      l
        .trim()
        .replace(/^["'`]+|["'`]+$/g, "")
        .replace(/^[-*\d.)\s]+/, "")
        .trim()
    )
    .filter(Boolean)

  let branch = ""
  let chatLabel = ""
  if (opts.shouldNameBranch) {
    branch = sanitizeBranchName(lines[0] ?? "")
    chatLabel = (lines[1] ?? "").replace(/^["'`]+|["'`]+$/g, "").trim()
  } else {
    chatLabel = (lines[0] ?? "").replace(/^["'`]+|["'`]+$/g, "").trim()
  }

  if (branch.length < 3 || branch.length > 50) branch = ""
  if (chatLabel.length < 2 || chatLabel.length > 60) {
    chatLabel = deriveFallbackName(opts.message).label
  }
  return {
    branch,
    chatLabel,
    title: opts.shouldNameBranch ? chatLabel : "",
  }
}

/**
 * If the proposed branch already exists on the remote, append `-2`, `-3`, ...
 * until we find an unused name. Same logic as v1's deduplicateBranchName,
 * just lifted out so we don't reach into the v1 route file.
 */
export async function deduplicateBranchName(
  room: RoomReader,
  branchName: string,
  userId: string
): Promise<string> {
  try {
    const repo = await room.readDoc(({ repos }) => {
      const firstRepo = repos.toArray()[0]
      if (!firstRepo) return null
      return { repoOwner: firstRepo.repoOwner, repoName: firstRepo.repoName }
    })
    if (!repo) return branchName

    const token = await getGitHubTokenForUser(userId)
    if (!token) return branchName

    const { repoOwner, repoName } = repo
    let candidate = branchName
    let suffix = 2

    for (let i = 0; i < 10; i++) {
      const res = await fetch(
        `${GITHUB_API_URL}/repos/${repoOwner}/${repoName}/git/ref/heads/${candidate}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
          },
        }
      )
      if (res.status === 404) return candidate
      if (!res.ok) return candidate // unexpected error — use as-is
      candidate = `${branchName}-${suffix}`
      suffix++
    }
    return candidate
  } catch (e) {
    console.error("v2 branch deduplication failed:", e)
    return branchName
  }
}
