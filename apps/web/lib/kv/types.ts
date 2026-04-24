export interface KVSetOptions {
  // Expiration in seconds
  ex?: number
  // Only set if the key does not already exist (used for distributed locks)
  nx?: boolean
}

// Minimal KV contract used by the app. Non-string values are expected to be
// JSON-serialized by the implementation on `set` and deserialized on `get`
// (Upstash does this transparently).
export interface KV {
  get<T = string>(key: string): Promise<T | null>
  set(
    key: string,
    value: unknown,
    options?: KVSetOptions,
  ): Promise<"OK" | null>
  del(key: string): Promise<void>
}
