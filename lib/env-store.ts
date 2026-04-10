import { Redis } from "@upstash/redis"
import { randomBytes, createCipheriv, createDecipheriv } from "crypto"

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

const ALGORITHM = "aes-256-gcm"
const KEY = Buffer.from(process.env.ENCRYPTION_KEY!, "hex") // 32 bytes

function encrypt(text: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, KEY, iv)
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  // iv (12) + tag (16) + ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString("base64")
}

function decrypt(data: string): string {
  const buf = Buffer.from(data, "base64")
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ciphertext = buf.subarray(28)
  const decipher = createDecipheriv(ALGORITHM, KEY, iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext) + decipher.final("utf8")
}

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
