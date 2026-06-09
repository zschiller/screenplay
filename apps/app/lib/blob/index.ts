import "server-only"

import { selectBlobStore } from "./select"
import type { BlobStore } from "./types"

export type { BlobStore, PutOptions, PutResult } from "./types"
export {
  BLOB_STORE_ENV_VAR,
  blobStoreChoiceFromEnv,
  selectBlobStore,
} from "./select"
export type { BlobStoreChoice } from "./select"

/**
 * The configured blob store singleton, selected at build time by the
 * `BLOB_STORE` env var — Vercel Blob by default (hosted, unchanged), the
 * local-fs store for the desktop build. See `./select`.
 */
export const blobStore: BlobStore = selectBlobStore()
