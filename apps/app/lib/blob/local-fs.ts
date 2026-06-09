import "server-only"

import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { BlobStore, PutResult } from "./types"

const DEFAULT_DIR = ".screenplay/blobs"
const DEFAULT_BASE_URL = "http://localhost:3000/blobs"

export type LocalFsBlobStoreConfig = {
  /** Directory blobs are written under (created on demand). */
  dir: string
  /**
   * Public base URL `dir` is served from on localhost. The returned
   * `PutResult.url` is `${baseUrl}/${key}`, so this must match however the
   * desktop sidecar exposes `dir` over localhost.
   */
  baseUrl: string
}

class LocalFsBlobStore implements BlobStore {
  constructor(private readonly config: LocalFsBlobStoreConfig) {}

  // `PutOptions` is intentionally not taken: the static localhost server that
  // serves `dir` infers the content type from the key's extension (e.g.
  // `.webp`), matching how the URL is read back, and `cacheControlMaxAge` has
  // no meaning for a local file read with no CDN in front of it. Implementing
  // the narrower `(key, body)` is a valid `BlobStore.put`.
  async put(key: string, body: Buffer | Uint8Array): Promise<PutResult> {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body)
    const path = join(this.config.dir, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, buffer)
    return { url: `${trimTrailingSlash(this.config.baseUrl)}/${key}` }
  }
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

/**
 * A {@link BlobStore} that writes blobs (thumbnails) to a local directory and
 * returns the localhost URL the desktop sidecar serves that directory from.
 * The hosted deployment never selects this (see `./select`).
 */
export function getLocalFsBlobStore(
  config: LocalFsBlobStoreConfig = {
    dir: process.env.LOCAL_BLOB_DIR ?? DEFAULT_DIR,
    baseUrl: process.env.LOCAL_BLOB_BASE_URL ?? DEFAULT_BASE_URL,
  }
): BlobStore {
  return new LocalFsBlobStore(config)
}
