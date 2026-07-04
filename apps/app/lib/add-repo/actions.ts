"use server"

import { getGitHubToken } from "@/lib/auth-helpers"
import { detectSettings } from "@/lib/add-repo/detect-settings"
import { GitHubDetectFileSystem } from "@/lib/add-repo/github-fs"
import type { DetectedSettings } from "@/lib/add-repo/resolver"

/**
 * The client entry to deterministic settings detection (PRD #673, slice #678).
 * The add modal calls this as it opens for a GitHub-repo pick; it resolves the
 * caller's token, backs detection with the GitHub-contents-API virtual FS, and
 * runs the `detectSettings` seam over it — no clone, no model.
 *
 * `{ ok: false }` covers every "just fall back to defaults" case (no token, a
 * repo the API can't read, a detector that throws); the modal's ~8s timeout
 * owns the slow-network case client-side so a hung request can't wedge it.
 */
export interface DetectRepoSettingsInput {
  owner: string
  repo: string
  /** Branch/tag/SHA to detect against — the picker hands the default branch. */
  ref: string
}

export type DetectRepoSettingsResult =
  | { ok: true; settings: DetectedSettings }
  | { ok: false }

export async function detectRepoSettings(
  input: DetectRepoSettingsInput
): Promise<DetectRepoSettingsResult> {
  try {
    const token = await getGitHubToken()
    if (!token) return { ok: false }
    const fs = new GitHubDetectFileSystem({ ...input, token })
    const settings = await detectSettings(fs)
    return { ok: true, settings }
  } catch {
    return { ok: false }
  }
}
