import "server-only"

export type PutResult = {
  /**
   * Public URL where the uploaded object can be read back. May differ from
   * `key` if the provider decorates the key (e.g. adds a random suffix for
   * cache-busting).
   */
  url: string
}

export type PutOptions = {
  contentType: string
  /**
   * `Cache-Control: public, max-age=...` hint for CDN/browser caches. The
   * provider is free to translate this to whatever its native API expects.
   */
  cacheControlMaxAge?: number
}

/**
 * The server-facing surface of an object/blob store. A store is a content-
 * addressable bucket of public-readable assets keyed by string paths.
 *
 * The default implementation (lib/blob/vercel.ts) wraps `@vercel/blob`. Any
 * backend that can store bytes and return a public URL works — S3, R2, GCS,
 * Supabase Storage, a self-hosted MinIO bucket, etc.
 */
export interface BlobStore {
  put(
    key: string,
    body: Buffer | Uint8Array,
    opts: PutOptions
  ): Promise<PutResult>
}
