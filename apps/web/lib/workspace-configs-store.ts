import { kv } from "./kv"
import { encrypt, decrypt } from "./crypto"
import type { WorkspaceConfig } from "./workspace-configs.types"

const PREFIX = "user-workspace-configs:"

export async function getConfigs(userId: string): Promise<WorkspaceConfig[]> {
  const data = await kv.get<string>(`${PREFIX}${userId}`)
  if (!data) return []
  return JSON.parse(decrypt(data)) as WorkspaceConfig[]
}

export async function saveConfigs(
  userId: string,
  list: WorkspaceConfig[],
): Promise<void> {
  const encrypted = encrypt(JSON.stringify(list))
  await kv.set(`${PREFIX}${userId}`, encrypted)
}
