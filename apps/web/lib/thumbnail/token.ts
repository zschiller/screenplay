import "server-only"

import { createHmac, timingSafeEqual } from "crypto"

const TOKEN_TTL_MS = 60_000

function getSecret(): string {
  const secret = process.env.THUMBNAIL_RENDER_SECRET
  if (!secret) {
    throw new Error("THUMBNAIL_RENDER_SECRET is not set")
  }
  return secret
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url")
}

export function signRenderToken(roomId: string, now = Date.now()): string {
  const exp = now + TOKEN_TTL_MS
  const payload = `${roomId}.${exp}`
  return `${payload}.${sign(payload)}`
}

export function verifyRenderToken(
  roomId: string,
  token: string,
  now = Date.now(),
): boolean {
  const parts = token.split(".")
  if (parts.length !== 3) return false
  const [tokenRoomId, expStr, sig] = parts as [string, string, string]
  if (tokenRoomId !== roomId) return false

  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp < now) return false

  const expected = sign(`${tokenRoomId}.${expStr}`)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
