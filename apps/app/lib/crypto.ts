import { randomBytes, createCipheriv, createDecipheriv } from "crypto"

const ALGORITHM = "aes-256-gcm"

// Resolve the 32-byte key lazily, not at module load. The hosted deploy always
// has ENCRYPTION_KEY set; the desktop build (issue #418) provisions it
// per-install at runtime. Module-load `Buffer.from(undefined, "hex")` throws
// before any handler runs, so importing this from a route that never encrypts
// (the common local path under host git auth) would crash the whole server.
// Reading inside the call mirrors the sibling secret-readers (thumbnail/token,
// terminal-credential): absent key → a clear error only when you actually
// encrypt, never at import.
let cachedKey: Buffer | undefined
function key(): Buffer {
  if (cachedKey) return cachedKey
  const hex = process.env.ENCRYPTION_KEY
  if (!hex) throw new Error("ENCRYPTION_KEY is not set")
  cachedKey = Buffer.from(hex, "hex") // 32 bytes
  return cachedKey
}

export function encrypt(text: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGORITHM, key(), iv)
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()
  // iv (12) + tag (16) + ciphertext
  return Buffer.concat([iv, tag, encrypted]).toString("base64")
}

export function decrypt(data: string): string {
  const buf = Buffer.from(data, "base64")
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const ciphertext = buf.subarray(28)
  const decipher = createDecipheriv(ALGORITHM, key(), iv)
  decipher.setAuthTag(tag)
  return decipher.update(ciphertext) + decipher.final("utf8")
}
