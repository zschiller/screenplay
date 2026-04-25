import "server-only"

import { put } from "@vercel/blob"
import type { BlobStore, PutOptions, PutResult } from "./types"

class VercelBlobStore implements BlobStore {
  async put(
    key: string,
    body: Buffer | Uint8Array,
    opts: PutOptions,
  ): Promise<PutResult> {
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body)
    const blob = await put(key, buffer, {
      access: "public",
      contentType: opts.contentType,
      addRandomSuffix: true,
      cacheControlMaxAge: opts.cacheControlMaxAge,
    })
    return { url: blob.url }
  }
}

export function getVercelBlobStore(): BlobStore {
  return new VercelBlobStore()
}
