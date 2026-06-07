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
