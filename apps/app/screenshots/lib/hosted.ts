import { createHmac } from "node:crypto"

import type { CaptureProfile } from "../profile"

/**
 * The signed-in session a **hosted** capture runs as (#789). The seeder writes
 * a `session` row with this token for the fixture user, and every capture
 * context carries the cookie Better Auth would have set after a GitHub
 * sign-in, so hosted screens load signed in without any OAuth round trip.
 */
export const FIXTURE_SESSION_TOKEN = "screenshot-fixture-session"

/** Better Auth's session cookie on plain http (no `__Secure-` prefix). */
const SESSION_COOKIE_NAME = "better-auth.session_token"

/**
 * The session cookie, signed the way Better Auth (via better-call's
 * `signCookieValue`) signs it: the token, a dot, and the base64 HMAC-SHA256 of
 * the token under `BETTER_AUTH_SECRET`, URI-encoded. The server rejects a
 * cookie that isn't signed with the secret it booted with.
 */
export function hostedSessionCookie(profile: CaptureProfile): {
  name: string
  value: string
} {
  const secret = profile.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error("the capture profile has no BETTER_AUTH_SECRET")
  const signature = createHmac("sha256", secret)
    .update(FIXTURE_SESSION_TOKEN)
    .digest("base64")
  return {
    name: SESSION_COOKIE_NAME,
    value: encodeURIComponent(`${FIXTURE_SESSION_TOKEN}.${signature}`),
  }
}
