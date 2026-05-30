import "server-only"

import { createHmac, timingSafeEqual } from "crypto"
import { canAccess } from "@/lib/rooms"

const TOKEN_TTL_MS = 60_000

function getSecret(): string {
  const secret = process.env.TERMINAL_AUTH_SECRET
  if (!secret) {
    throw new Error("TERMINAL_AUTH_SECRET is not set")
  }
  return secret
}

function sign(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url")
}

export interface TerminalCredential {
  token: string
  expiresAt: number
}

/**
 * Mint a short-lived terminal credential for a room member, or `null` if the
 * user isn't a member of the room. Reuses `canAccess` — the same gate behind
 * `/api/yjs/auth` and Y.Doc sync — so there's one membership mechanism to
 * reason about.
 */
export async function issueTerminalCredential(
  input: {
    roomId: string
    sessionId: string
    userId: string
  },
  now = Date.now(),
): Promise<TerminalCredential | null> {
  if (!(await canAccess(input.roomId, input.userId))) return null

  const expiresAt = now + TOKEN_TTL_MS
  const payload = `${input.roomId}.${input.sessionId}.${input.userId}.${expiresAt}`
  return { token: `${payload}.${sign(payload)}`, expiresAt }
}

export type TerminalCredentialCheck =
  | { ok: true; userId: string }
  | { ok: false }

/**
 * Verify a presented terminal credential, binding it to the room and session
 * the connection is for. Returns the user the credential was minted for so the
 * caller can re-check membership on connect (continuous authorization). Any
 * signature, binding, or expiry mismatch fails closed.
 */
export function verifyTerminalCredential(
  token: string,
  binding: { roomId: string; sessionId: string },
  now = Date.now(),
): TerminalCredentialCheck {
  const parts = token.split(".")
  if (parts.length !== 5) return { ok: false }
  const [roomId, sessionId, userId, expStr, sig] = parts as [
    string,
    string,
    string,
    string,
    string,
  ]
  if (roomId !== binding.roomId || sessionId !== binding.sessionId) {
    return { ok: false }
  }

  const exp = Number(expStr)
  if (!Number.isFinite(exp) || exp < now) return { ok: false }

  const expected = sign(`${roomId}.${sessionId}.${userId}.${expStr}`)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false }

  return { ok: true, userId }
}
