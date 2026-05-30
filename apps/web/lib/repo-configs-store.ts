import { kv } from "./kv"
import { encrypt, decrypt } from "./crypto"
import type { RepoConfig } from "./repo-configs.types"

// The kv-store key literal is intentionally kept as `user-workspace-configs:`
// (not `user-repo-configs:`) for back-compat: renaming it would orphan every
// existing user's saved repositories and encrypted env vars. Leave it as-is.
const PREFIX = "user-workspace-configs:"

export async function getConfigs(userId: string): Promise<RepoConfig[]> {
  const data = await kv.get<string>(`${PREFIX}${userId}`)
  if (!data) return []
  return JSON.parse(decrypt(data)) as RepoConfig[]
}

export async function saveConfigs(
  userId: string,
  list: RepoConfig[],
): Promise<void> {
  const encrypted = encrypt(JSON.stringify(list))
  await kv.set(`${PREFIX}${userId}`, encrypted)
}
