import "server-only"

import { getVercelBlobStore } from "./vercel"
import type { BlobStore } from "./types"

export type { BlobStore, PutOptions, PutResult } from "./types"

/**
 * The configured blob store singleton. Today this is always Vercel Blob;
 * making it an env-switched factory is a one-line change once a second
 * implementation lands.
 */
export const blobStore: BlobStore = getVercelBlobStore()
