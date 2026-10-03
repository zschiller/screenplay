import "server-only"

import { kv } from "@/lib/kv"
import { encrypt, decrypt } from "@/lib/crypto"
import type { MemoryData } from "@/lib/types"
import type { AccountMemoryStore } from "./account"

const PREFIX = "account-memory:"

/** One person's account memory in the encrypted per-user KV store, beside
 *  their Repositories (`lib/repository-library/store.ts`). Hosted and desktop
 *  alike: the desktop app runs as its one local user. */
export function kvAccountMemoryStore(userId: string): AccountMemoryStore {
  return {
    async load() {
      const data = await kv.get<string>(`${PREFIX}${userId}`)
      if (!data) return []
      return JSON.parse(decrypt(data)) as MemoryData[]
    },
    async save(entries) {
      await kv.set(`${PREFIX}${userId}`, encrypt(JSON.stringify(entries)))
    },
  }
}
