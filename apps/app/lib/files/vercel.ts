import "server-only"

import { BlobNotFoundError, del, get, head, put } from "@vercel/blob"
import type { FileStore } from "./store"

/**
 * The env var holding the private Vercel Blob store's token. A second store,
 * apart from the public one thumbnails use (`PUBLIC_BLOB_READ_WRITE_TOKEN`): a
 * store's access is fixed when it's created, and the public one can't be
 * made private.
 */
export const PRIVATE_BLOB_TOKEN_ENV_VAR = "PRIVATE_BLOB_READ_WRITE_TOKEN"

/** A {@link FileStore} on a private Vercel Blob store. */
export function vercelFileStore(
  token: string | undefined = process.env[PRIVATE_BLOB_TOKEN_ENV_VAR]
): FileStore {
  const auth = () => {
    if (!token) {
      throw new Error(
        `Files aren't set up on this server: ${PRIVATE_BLOB_TOKEN_ENV_VAR} isn't set.`
      )
    }
    return token
  }
  return {
    async put(key, body, contentType) {
      await put(key, Buffer.from(body), {
        access: "private",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: true,
        token: auth(),
      })
    },
    async get(key) {
      try {
        const result = await get(key, {
          access: "private",
          useCache: false,
          token: auth(),
        })
        if (!result || result.statusCode !== 200) return null
        return new Uint8Array(await new Response(result.stream).arrayBuffer())
      } catch (e) {
        if (e instanceof BlobNotFoundError) return null
        throw e
      }
    },
    async delete(keys) {
      if (keys.length) await del([...keys], { token: auth() })
    },
    async size(key) {
      try {
        return (await head(key, { token: auth() })).size
      } catch (e) {
        if (e instanceof BlobNotFoundError) return null
        throw e
      }
    },
  }
}
