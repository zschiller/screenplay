import "server-only"

import { kv } from "@/lib/kv"
import { encrypt, decrypt } from "@/lib/crypto"
import type { RepoConfig } from "@/lib/repo-configs.types"
import type { RepositoryStore } from "./library"

// The kv-store key literal is intentionally kept as `user-workspace-configs:`
// (not `user-repositories:`) for back-compat: renaming it would orphan every
// existing user's saved repositories and encrypted env vars. Leave it as-is.
const PREFIX = "user-workspace-configs:"

/** Set once a user's Canvases are linked to their Repositories (#1420). The
 *  screenshot seed writes it too, so fixture worlds skip the migration. */
const MIGRATED_PREFIX = "repository-library-migrated:"

/** One person's Repositories in the encrypted per-user KV store. */
export function kvRepositoryStore(userId: string): RepositoryStore {
  return {
    async load() {
      const data = await kv.get<string>(`${PREFIX}${userId}`)
      if (!data) return []
      return JSON.parse(decrypt(data)) as RepoConfig[]
    },
    async save(list) {
      await kv.set(`${PREFIX}${userId}`, encrypt(JSON.stringify(list)))
    },
    async isMigrated() {
      return (await kv.get(`${MIGRATED_PREFIX}${userId}`)) !== null
    },
    async markMigrated() {
      await kv.set(`${MIGRATED_PREFIX}${userId}`, "1")
    },
  }
}
