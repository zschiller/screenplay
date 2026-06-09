import "server-only"

import { getLocalFsBlobStore } from "./local-fs"
import type { BlobStore } from "./types"
import { getVercelBlobStore } from "./vercel"

/**
 * Which {@link BlobStore} backend a build runs on. Mirrors the engine seam's
 * selection style (`AGENT_ENGINE`): a per-build env var, not a per-Room column,
 * so one repo produces both the hosted deployment (Vercel Blob) and the desktop
 * build (local-fs) without forking call sites.
 */
export type BlobStoreChoice = "vercel" | "local-fs"

/** The env var a build sets to pick the blob backend. */
export const BLOB_STORE_ENV_VAR = "BLOB_STORE"

/**
 * Read the blob backend choice from the environment, defaulting to `vercel`
 * (the hosted default). Only the explicit value `local-fs` opts into the
 * local-filesystem store; anything else — unset, empty, or unrecognised — stays
 * on Vercel Blob, so a typo never silently swaps the store.
 */
export function blobStoreChoiceFromEnv(
  env: Record<string, string | undefined> = process.env
): BlobStoreChoice {
  return env[BLOB_STORE_ENV_VAR] === "local-fs" ? "local-fs" : "vercel"
}

/** Resolve the configured {@link BlobStore} for the current build. */
export function selectBlobStore(
  env: Record<string, string | undefined> = process.env
): BlobStore {
  return blobStoreChoiceFromEnv(env) === "local-fs"
    ? getLocalFsBlobStore()
    : getVercelBlobStore()
}
