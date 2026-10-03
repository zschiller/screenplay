import "server-only"

import { decrypt, encrypt } from "@/lib/crypto"
import { kv } from "@/lib/kv"
import type { RepoData } from "@/lib/types"
import { canvasRepoEnvKey, envVarsDigest } from "./encoding"
import { envVarNames } from "./names"

export { envVarsDigest }

/**
 * Where a Canvas Repo's env var values live (#1416): encrypted with
 * `ENCRYPTION_KEY` in the KV store, one entry per Canvas + Repo, like
 * Repositories (`lib/repository-library/store`) and per-sandbox env
 * (`lib/env-store`). The room doc keeps only the names and a digest.
 */
export interface CanvasRepoEnvStore {
  /** The values as `KEY=value` text; `null` when none were ever stored. */
  get(roomId: string, repoId: string): Promise<string | null>
  /** Store the values; empty text deletes the entry. */
  set(roomId: string, repoId: string, text: string): Promise<void>
}

const key = canvasRepoEnvKey

export const kvCanvasRepoEnvStore: CanvasRepoEnvStore = {
  async get(roomId, repoId) {
    const data = await kv.get<string>(key(roomId, repoId))
    return data ? decrypt(data) : null
  },
  async set(roomId, repoId, text) {
    if (envVarNames(text).length === 0) {
      await kv.del(key(roomId, repoId))
      return
    }
    await kv.set(key(roomId, repoId), encrypt(text))
  },
}

/** What the room doc records about a Repo's values: names and digest. */
export function envDocFields(
  text: string
): Pick<RepoData, "envVarNames" | "envVarsDigest" | "envVars"> {
  const names = envVarNames(text)
  return {
    envVarNames: names.length > 0 ? names : undefined,
    envVarsDigest: envVarsDigest(text),
    // Clears a legacy plain-text copy wherever the new fields are written.
    envVars: undefined,
  }
}

/** A Repo's values: the stored ones, or its legacy plain-text copy when the
 *  migration hasn't moved it yet. */
export async function loadCanvasRepoEnv(
  store: CanvasRepoEnvStore,
  roomId: string,
  repo: Pick<RepoData, "id" | "envVars">
): Promise<string> {
  return (await store.get(roomId, repo.id)) ?? repo.envVars ?? ""
}
