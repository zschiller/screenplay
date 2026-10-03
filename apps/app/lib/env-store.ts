import { secretPatterns } from "./agent/redact"
import { kv } from "./kv"
import { encrypt, decrypt } from "./crypto"

const PREFIX = "sandbox-env:"

export async function storeEnvVars(
  sandboxName: string,
  env: Record<string, string>
): Promise<void> {
  const encrypted = encrypt(JSON.stringify(env))
  await kv.set(`${PREFIX}${sandboxName}`, encrypted)
}

export async function getEnvVars(
  sandboxName: string
): Promise<Record<string, string> | null> {
  const data = await kv.get<string>(`${PREFIX}${sandboxName}`)
  if (!data) return null
  return JSON.parse(decrypt(data))
}

export async function deleteEnvVars(sandboxName: string): Promise<void> {
  await kv.del(`${PREFIX}${sandboxName}`)
}

/**
 * The strings a chat on this sandbox scrubs from what it shows (#1416): its
 * env var values and their encoded forms, loaded once per turn. None when the
 * sandbox has no env vars or the store can't be read.
 */
export async function sandboxSecrets(sandboxName: string): Promise<string[]> {
  if (!sandboxName) return []
  const env = await getEnvVars(sandboxName).catch(() => null)
  return env ? secretPatterns(Object.values(env)) : []
}
