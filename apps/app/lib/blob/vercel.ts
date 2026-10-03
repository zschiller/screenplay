import "server-only"

import { put } from "@vercel/blob"
import type { BlobStore, PutOptions, PutResult } from "./types"

/**
 * The env var holding the public Vercel Blob store's token (thumbnails). Files
 * live in a separate private store, `PRIVATE_BLOB_READ_WRITE_TOKEN`.
 */
export const PUBLIC_BLOB_TOKEN_ENV_VAR = "PUBLIC_BLOB_READ_WRITE_TOKEN"

class VercelBlobStore implements BlobStore {
  async put(
    key: string,
    body: Buffer | Uint8Array,
    opts: PutOptions
  ): Promise<PutResult> {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body)
    const blob = await put(key, buffer, {
      access: "public",
      contentType: opts.contentType,
      addRandomSuffix: true,
      cacheControlMaxAge: opts.cacheControlMaxAge,
      token: process.env[PUBLIC_BLOB_TOKEN_ENV_VAR],
    })
    return { url: blob.url }
  }
}

export function getVercelBlobStore(): BlobStore {
  return new VercelBlobStore()
}
