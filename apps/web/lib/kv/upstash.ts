import { Redis } from "@upstash/redis"
import type { KV } from "./types"

export function createUpstashKV(): KV {
  const redis = new Redis({
    url: process.env.KV_REST_API_URL!,
    token: process.env.KV_REST_API_TOKEN!,
  })

  return {
    get: (key) => redis.get(key),
    // Upstash's `set` overload uses a discriminated union to pair `ex`/`nx`;
    // our interface takes them as plain optionals, so we cast through.
    set: (key, value, options) =>
      redis.set(
        key,
        value,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        options as any,
      ) as Promise<"OK" | null>,
    del: async (key) => {
      await redis.del(key)
    },
  }
}
