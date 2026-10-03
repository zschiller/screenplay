import "server-only"

import { decrypt, encrypt } from "@/lib/crypto"
import { kv } from "@/lib/kv"
import type { FileEntryData } from "@/lib/types"
import type { FileListStore } from "./account-files"

/** How long a write holds the list, and how long another waits for it. */
const LOCK_TTL_SEC = 10
const LOCK_WAIT_MS = 5_000

/** Each list's last queued write in this process, by KV key. */
const queues = new Map<string, Promise<void>>()

/**
 * One person's Account Files entries (#1521) in the encrypted per-user KV
 * store, beside their account memory (`lib/memory/account-store.ts`). Paths
 * can say as much as a file does, so they're encrypted too. Hosted and
 * desktop alike: the desktop app runs as its one local user.
 */
export function kvAccountFileStore(userId: string): FileListStore {
  return kvFileListStore(`account-files:${userId}`)
}

/**
 * One person's Account Skills entries (#1558), a list of their own beside
 * their Account Files, so a Skill's folder never shows in the Files tree.
 */
export function kvAccountSkillStore(userId: string): FileListStore {
  return kvFileListStore(`account-skills:${userId}`)
}

function kvFileListStore(key: string): FileListStore {
  return {
    async load() {
      const data = await kv.get<string>(key)
      if (!data) return []
      return JSON.parse(decrypt(data)) as FileEntryData[]
    },
    async save(entries) {
      await kv.set(key, encrypt(JSON.stringify(entries)))
    },
    exclusive(fn) {
      // Writes in this process queue on each other; the KV lock holds off
      // writes from another server instance.
      const run = (queues.get(key) ?? Promise.resolve()).then(async () => {
        const lock = await waitForLock(`${key}:lock`)
        try {
          return await fn()
        } finally {
          await lock?.release().catch(() => false)
        }
      })
      const tail = run.then(
        () => {},
        () => {}
      )
      queues.set(key, tail)
      void tail.then(() => {
        if (queues.get(key) === tail) queues.delete(key)
      })
      return run
    },
  }
}

/**
 * The list's lock, waiting a little for a write elsewhere to finish. A lock
 * that never frees (a crashed holder) expires; past the wait, the write goes
 * ahead rather than failing the save.
 */
async function waitForLock(key: string) {
  const until = Date.now() + LOCK_WAIT_MS
  for (;;) {
    const lock = await kv.acquireLock(key, LOCK_TTL_SEC)
    if (lock || Date.now() > until) return lock
    await new Promise((r) => setTimeout(r, 50))
  }
}
