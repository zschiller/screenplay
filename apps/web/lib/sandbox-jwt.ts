import { createHmac, timingSafeEqual } from "crypto"

// Short-lived JWTs signed per-command so the in-sandbox git credential helper
// can mint the acting user's GitHub token without any persistent secret
// living inside the (shared, multi-user) sandbox.
//
// 5 minutes is enough for a single git push to complete and small enough that
// a leaked token can't be replayed long after the user's turn ended.
const DEFAULT_TTL_SECONDS = 5 * 60

export interface SandboxAuthClaims {
  userId: string
  sandboxName: string
  exp: number
}

function getSecret(): Buffer {
  const raw = process.env.SANDBOX_JWT_SECRET
  if (!raw) {
    throw new Error(
      "SANDBOX_JWT_SECRET is not set — required to sign sandbox auth tokens",
    )
  }
  return Buffer.from(raw, "utf8")
}

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")
}

function fromBase64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64")
}

export function signSandboxAuth(
  userId: string,
  sandboxName: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): string {
  const claims: SandboxAuthClaims = {
    userId,
    sandboxName,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }
  const payload = base64url(Buffer.from(JSON.stringify(claims)))
  const sig = base64url(createHmac("sha256", getSecret()).update(payload).digest())
  return `${payload}.${sig}`
}

export function verifySandboxAuth(token: string): SandboxAuthClaims | null {
  const parts = token.split(".")
  if (parts.length !== 2) return null
  const [payload, sig] = parts

  const expected = createHmac("sha256", getSecret()).update(payload).digest()
  const given = fromBase64url(sig)
  if (expected.length !== given.length) return null
  if (!timingSafeEqual(expected, given)) return null

  let claims: SandboxAuthClaims
  try {
    claims = JSON.parse(fromBase64url(payload).toString("utf8"))
  } catch {
    return null
  }
  if (typeof claims.userId !== "string" || !claims.userId) return null
  if (typeof claims.sandboxName !== "string" || !claims.sandboxName) return null
  if (typeof claims.exp !== "number") return null
  if (claims.exp < Math.floor(Date.now() / 1000)) return null
  return claims
}
