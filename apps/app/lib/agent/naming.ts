import "server-only"

import { generateText } from "ai"
import { getGitHubTokenForUser } from "@/lib/auth-helpers"
import { readRoomDoc } from "@/lib/yjs/server"
import { resolveLanguageModel, DEFAULT_MODEL } from "./providers"

/**
 * Generate a git branch name and a chat label from the user's first message.
 * Mirrors the v1 stream route's behavior (one cheap LLM call, two-line
 * output) but routes through the AI SDK so it works against whichever
 * provider the deployment has configured.
 *
 * Returns `{ branch: "" }` if naming is skipped (`shouldNameBranch=false`).
 */
export async function generateChatNames(opts: {
  message: string
  shouldNameBranch: boolean
  /** Provider:model id used for the naming call. Defaults to DEFAULT_MODEL. */
  model?: string
}): Promise<{ branch: string; chatLabel: string }> {
  const system = opts.shouldNameBranch
    ? "Generate two things for the user's request:\n1. A short, lowercase, hyphenated git branch name (2-4 words)\n2. A short chat label (2-5 words, title case)\n\nOutput ONLY as two lines, no explanation, backticks, or quotes.\nLine 1: branch name\nLine 2: chat label\n\nExamples:\nfix-login-button\nFix Login Button\n\nadd-dark-mode\nAdd Dark Mode"
    : "Generate a short chat label for the user's request (2-5 words, title case). Output ONLY the label — no explanation, backticks, or quotes.\n\nExamples:\nFix Login Button\nAdd Dark Mode"

  let rawText = ""
  try {
    const result = await generateText({
      model: resolveLanguageModel(opts.model ?? DEFAULT_MODEL),
      system,
      prompt: opts.message,
    })
    rawText = result.text.trim()
  } catch (e) {
    console.error("v2 chat-naming generation failed:", e)
    return { branch: "", chatLabel: deriveFallbackLabel(opts.message) }
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
    branch = (lines[0] ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
    chatLabel = (lines[1] ?? "").replace(/^["'`]+|["'`]+$/g, "").trim()
  } else {
    chatLabel = (lines[0] ?? "").replace(/^["'`]+|["'`]+$/g, "").trim()
  }

  if (branch.length < 3 || branch.length > 50) branch = ""
  if (chatLabel.length < 2 || chatLabel.length > 60) {
    chatLabel = deriveFallbackLabel(opts.message)
  }
  return { branch, chatLabel }
}

/**
 * If the proposed branch already exists on the remote, append `-2`, `-3`, ...
 * until we find an unused name. Same logic as v1's deduplicateBranchName,
 * just lifted out so we don't reach into the v1 route file.
 */
export async function deduplicateBranchName(
  roomId: string,
  branchName: string,
  userId: string
): Promise<string> {
  try {
    const repo = await readRoomDoc(roomId, ({ repos }) => {
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
        `https://api.github.com/repos/${repoOwner}/${repoName}/git/ref/heads/${candidate}`,
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

function deriveFallbackLabel(message: string): string {
  const cleaned = message.replace(/\s+/g, " ").trim()
  if (!cleaned) return ""
  const words = cleaned.split(" ").slice(0, 6).join(" ")
  return words.length > 50 ? `${words.slice(0, 50).trimEnd()}…` : words
}
