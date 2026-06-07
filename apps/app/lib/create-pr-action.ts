"use server"

import { redactSensitiveInfo } from "@/lib/agent/redact"
import { requireUserId } from "@/lib/auth-helpers"
import { createGitHubPr } from "@/lib/github-pr"
import type { SandboxActionResult } from "@/lib/sandbox/run"

/**
 * Open a GitHub PR for the given branch directly from the UI — the same
 * deterministic path the `create_pr` agent tool wraps, but with no model turn
 * in the loop (#355). Title/body are synthesised server-side from the branch's
 * commits inside {@link createGitHubPr}.
 *
 * Shares the {@link SandboxActionResult} contract used by the sandbox actions:
 * the created PR rides back as a value on success, and any throw collapses to a
 * `{ success: false }` whose `error` is redacted at the boundary — the GitHub
 * token can leak into a failure message, so it never crosses unscrubbed.
 */
export async function createPullRequestAction(
  roomId: string,
  sandboxName: string
): Promise<SandboxActionResult<{ url: string; number: number }>> {
  try {
    const userId = await requireUserId()
    const { url, number } = await createGitHubPr({ userId, roomId, sandboxName })
    return { success: true, value: { url, number } }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, error: redactSensitiveInfo(message) }
  }
}
