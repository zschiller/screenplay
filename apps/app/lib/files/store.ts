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
  /** How many bytes are under `key`, or `null` when there are none. */
  size(key: string): Promise<number | null>
  /**
   * Every key that starts with `prefix`, with its size: a Mockup's folder
   * (`lib/mockup-folder`) is the keys under its prefix.
   */
  list(prefix: string): Promise<{ key: string; size: number }[]>
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
    async size(key) {
      return blobs.get(key)?.byteLength ?? null
    },
    async list(prefix) {
      return [...blobs]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, body]) => ({ key, size: body.byteLength }))
        .sort((a, b) => (a.key < b.key ? -1 : 1))
    },
    keys: () => [...blobs.keys()].sort(),
  }
}
