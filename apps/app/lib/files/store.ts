/**
 * The private **file store** that holds Canvas Files' bytes (#1514). Unlike
 * the public blob store (`lib/blob`, thumbnails), nothing in it has a URL
 * anyone can fetch: bytes go out only through a route that checks who is
 * asking. Keys are opaque, chosen by the files module.
 */
export interface FileStore {
  /** Write `body` under `key`, replacing whatever was there. */
  put(key: string, body: Uint8Array, contentType: string): Promise<void>
  /** The bytes under `key`, or `null` when there are none. */
  get(key: string): Promise<Uint8Array | null>
  /** Delete every key given; a key with nothing under it is fine. */
  delete(keys: readonly string[]): Promise<void>
}

/** A {@link FileStore} in memory, for tests and anything that needs no disk. */
export function memoryFileStore(): FileStore & { keys(): string[] } {
  const blobs = new Map<string, Uint8Array>()
  return {
    async put(key, body) {
      blobs.set(key, Uint8Array.from(body))
    },
    async get(key) {
      return blobs.get(key) ?? null
    },
    async delete(keys) {
      for (const key of keys) blobs.delete(key)
    },
    keys: () => [...blobs.keys()].sort(),
  }
}
