import { Redis } from "@upstash/redis"
import { encrypt, decrypt } from "./crypto"
import type { WorkspaceConfig } from "./workspace-configs.types"

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

const PREFIX = "user-workspace-configs:"

export async function getConfigs(userId: string): Promise<WorkspaceConfig[]> {
  const data = await redis.get<string>(`${PREFIX}${userId}`)
  if (!data) return []
  return JSON.parse(decrypt(data)) as WorkspaceConfig[]
}

export async function saveConfigs(
  userId: string,
  list: WorkspaceConfig[],
): Promise<void> {
  const encrypted = encrypt(JSON.stringify(list))
  await redis.set(`${PREFIX}${userId}`, encrypted)
}
