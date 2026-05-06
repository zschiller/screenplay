import "server-only"

import { kv } from "@/lib/kv"
import type { ModelInfo } from "./types"

type CacheEntry = Array<Omit<ModelInfo, "provider">>

const TTL_SECONDS = 60 * 60 // 1h
const NEGATIVE_TTL_SECONDS = 60 // 1m on errors so a transient blip clears fast

/**
 * Wrap a provider's live discovery call with a short-lived cache so opening
 * the model picker doesn't fan out an upstream API call per dropdown render.
 *
 * - Hot in-memory cache for snappy repeated reads inside the same process.
 * - Cold KV cache so a cold-start serverless worker reuses recent listings
 *   from another process.
 * - On error, falls back to the previous KV value if present, otherwise to
 *   the supplied curated list. Either fallback is itself cached for a
 *   shorter window (`NEGATIVE_TTL_SECONDS`) so we don't hammer a flapping
 *   upstream while still recovering quickly when it heals.
 */
const memoryCache = new Map<string, { value: CacheEntry; expiresAt: number }>()

export async function discover(opts: {
  /** Cache key — should incorporate the provider key + any config that scopes the listing (e.g. baseURL for openai-compatible). */
  cacheKey: string
  /** Fetches the live list. Throws on upstream failure; this helper handles fallback. */
  fetchLive: () => Promise<CacheEntry>
  /** Curated fallback used only when both live and stale-KV reads fail. */
  fallback: CacheEntry
}): Promise<CacheEntry> {
  const now = Date.now()
  const hot = memoryCache.get(opts.cacheKey)
  if (hot && hot.expiresAt > now) return hot.value

  const stored = await kv.get<CacheEntry>(opts.cacheKey).catch(() => null)
  if (stored) {
    memoryCache.set(opts.cacheKey, {
      value: stored,
      expiresAt: now + TTL_SECONDS * 1000,
    })
    return stored
  }

  try {
    const fresh = await opts.fetchLive()
    await kv.set(opts.cacheKey, fresh, { ex: TTL_SECONDS }).catch(() => {})
    memoryCache.set(opts.cacheKey, {
      value: fresh,
      expiresAt: now + TTL_SECONDS * 1000,
    })
    return fresh
  } catch (e) {
    console.error(`Model discovery failed for ${opts.cacheKey}:`, e)
    // Negative-cache the fallback briefly so a flapping upstream doesn't
    // get hammered, but the next ~minute recovers cleanly.
    memoryCache.set(opts.cacheKey, {
      value: opts.fallback,
      expiresAt: now + NEGATIVE_TTL_SECONDS * 1000,
    })
    return opts.fallback
  }
}

/** Test/admin hook — manually invalidate every cached listing. */
export function clearAll() {
  memoryCache.clear()
}
