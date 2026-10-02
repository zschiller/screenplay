import "server-only"

import { createHmac } from "node:crypto"

/**
 * Frame Stream credentials (#1392). The in-Sandbox service holds a key derived
 * from `TERMINAL_AUTH_SECRET` and the Sandbox's name, so each Workspace's key
 * is its own and the deployment secret never enters a Sandbox. The app signs
 * two kinds of short-lived token with it, after its own checks:
 *
 * - `view`: a Canvas member may watch the Workspace's frames. Sent as the
 *   first WebSocket message, never in the URL.
 * - `drive`: the member is the frame's driver in Frame Control, so their
 *   input may reach that frame's page. The newest grant for a frame wins.
 *
 * Token: `base64url(JSON claims) "." base64url(HMAC-SHA256(key, body))`,
 * verified by `lib/sandbox-bridge/frame-stream.mjs`.
 */

export const FRAME_STREAM_TOKEN_TTL_MS = 60_000

export type FrameStreamClaims =
  | { k: "view"; sub: string; exp: number }
  | { k: "drive"; sub: string; frame: string; exp: number }

/** The Workspace's stream key, handed to its service at launch. */
export function frameStreamKey(sandboxName: string): string {
  const secret = process.env.TERMINAL_AUTH_SECRET
  if (!secret) throw new Error("TERMINAL_AUTH_SECRET is not set")
  return createHmac("sha256", secret)
    .update(`frame-stream:${sandboxName}`)
    .digest("base64url")
}

export function signFrameStreamToken(
  key: string,
  claims: FrameStreamClaims
): string {
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url")
  const sig = createHmac("sha256", key).update(body).digest("base64url")
  return `${body}.${sig}`
}

export function viewToken(
  key: string,
  userId: string,
  now = Date.now()
): { token: string; expiresAt: number } {
  const exp = now + FRAME_STREAM_TOKEN_TTL_MS
  return {
    token: signFrameStreamToken(key, { k: "view", sub: userId, exp }),
    expiresAt: exp,
  }
}

export function driveToken(
  key: string,
  userId: string,
  frame: string,
  now = Date.now()
): { token: string; expiresAt: number } {
  const exp = now + FRAME_STREAM_TOKEN_TTL_MS
  return {
    token: signFrameStreamToken(key, { k: "drive", sub: userId, frame, exp }),
    expiresAt: exp,
  }
}
