"use server"

import { getGitHubToken } from "@/lib/auth-helpers"
import { detectSettings } from "@/lib/add-repo/detect-settings"
import { DiskDetectFileSystem } from "@/lib/add-repo/disk-fs"
import { GitHubDetectFileSystem } from "@/lib/add-repo/github-fs"
import { detectSettingsWithModel } from "@/lib/add-repo/model-detect"
import type { DetectFileSystem } from "@/lib/add-repo/detect-fs"
import { runOneShotModel } from "@/lib/agent/one-shot-model"
import { fixtureModelReply } from "@/lib/fixture-model"
import { isLocalBuild } from "@/lib/local-mode"
import type { DetectedSettings } from "@/lib/add-repo/resolver"

/**
 * The client entry to deterministic settings detection (PRD #673, slice #678).
 * The add modal calls this as it opens for a GitHub-repo pick; it resolves the
 * caller's token, backs detection with the GitHub-contents-API virtual FS, and
 * runs the `detectSettings` seam over it — no clone, no model. The model pass
 * ({@link refineRepoSettings}) follows it.
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
  { ok: true; settings: DetectedSettings } | { ok: false }

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

/**
 * The client entry to deterministic settings detection for a **local-folder**
 * pick (PRD #673, desktop funnel slice #682). The add modal calls this as it
 * opens for a folder source: it backs detection with the on-disk virtual FS
 * rooted at the checkout and runs the `detectSettings` seam over it — no GitHub
 * connection, no clone. Desktop-only (the on-disk read has no meaning on a
 * hosted server); the hosted build funnels folders nowhere, so this no-ops to
 * `{ ok: false }` — the modal's plain defaults — off-desktop.
 */
export interface DetectFolderSettingsInput {
  /** Absolute path of the user's checkout — `NewRepoSource.localPath`. */
  localPath: string
}

export async function detectFolderSettings(
  input: DetectFolderSettingsInput
): Promise<DetectRepoSettingsResult> {
  if (!isLocalBuild) return { ok: false }
  try {
    const fs = new DiskDetectFileSystem(input.localPath)
    const settings = await detectSettings(fs)
    return { ok: true, settings }
  } catch {
    return { ok: false }
  }
}

/**
 * How long the model pass may take server-side. The modal's own timeout sits
 * just above it, so a slow model degrades to "keep the rule-based result"
 * rather than a hung spinner.
 */
const MODEL_DETECTION_TIMEOUT_MS = 30_000

/**
 * The model-assisted second pass for a GitHub-repo pick: the same virtual FS
 * as {@link detectRepoSettings}, read by a model that refines the rule-based
 * `baseline`. `{ ok: false }` when no token, no model, or no usable answer, so
 * the modal keeps what the first pass found.
 */
export async function refineRepoSettings(
  input: DetectRepoSettingsInput,
  baseline: DetectedSettings
): Promise<DetectRepoSettingsResult> {
  try {
    const token = await getGitHubToken()
    if (!token) return { ok: false }
    const fs = new GitHubDetectFileSystem({ ...input, token })
    return await refineWithModel(fs, baseline)
  } catch {
    return { ok: false }
  }
}

/** The model-assisted second pass for a local-folder pick (desktop only). */
export async function refineFolderSettings(
  input: DetectFolderSettingsInput,
  baseline: DetectedSettings
): Promise<DetectRepoSettingsResult> {
  if (!isLocalBuild) return { ok: false }
  try {
    const fs = new DiskDetectFileSystem(input.localPath)
    return await refineWithModel(fs, baseline)
  } catch {
    return { ok: false }
  }
}

async function refineWithModel(
  fs: DetectFileSystem,
  baseline: DetectedSettings
): Promise<DetectRepoSettingsResult> {
  const fixtureReply = await fixtureModelReply()
  const settings = await detectSettingsWithModel(fs, baseline, (opts) =>
    fixtureReply !== undefined
      ? Promise.resolve(fixtureReply)
      : runOneShotModel({ ...opts, timeoutMs: MODEL_DETECTION_TIMEOUT_MS })
  )
  return settings ? { ok: true, settings } : { ok: false }
}
