import { keyedDigest } from "@/lib/crypto"
import { parseEnvVars } from "@/lib/env-utils"

/**
 * How a Canvas Repo's env var values are kept (#1416), apart from the KV
 * itself so the screenshot seeder can write them the way the app reads them.
 */

/** The KV key holding one Canvas Repo's encrypted values. */
export function canvasRepoEnvKey(roomId: string, repoId: string): string {
  return `canvas-repo-env:${roomId}:${repoId}`
}

/**
 * A keyed digest of what a `KEY=value` text sets (order and comments
 * ignored), so "customized" can compare a Canvas Repo's values with its
 * Repository's without either side seeing them. `undefined` for none.
 */
export function envVarsDigest(text: string): string | undefined {
  const entries = Object.entries(parseEnvVars(text)).sort(([a], [b]) =>
    a.localeCompare(b)
  )
  if (entries.length === 0) return undefined
  return keyedDigest(JSON.stringify(entries)).slice(0, 32)
}
