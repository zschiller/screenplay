import { Redis } from "@upstash/redis"
import { encrypt, decrypt } from "./crypto"

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

const PREFIX = "sandbox-env:"

export async function storeEnvVars(
  sandboxName: string,
  env: Record<string, string>,
): Promise<void> {
  const encrypted = encrypt(JSON.stringify(env))
  await redis.set(`${PREFIX}${sandboxName}`, encrypted)
}

export async function getEnvVars(
  sandboxName: string,
): Promise<Record<string, string> | null> {
  const data = await redis.get<string>(`${PREFIX}${sandboxName}`)
  if (!data) return null
  return JSON.parse(decrypt(data))
}

export async function deleteEnvVars(sandboxName: string): Promise<void> {
  await redis.del(`${PREFIX}${sandboxName}`)
}
