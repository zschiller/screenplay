// A canvas's link for viewers (Sharing, #1932): one per canvas, for as long
// as the install keeps its secret, with no reset. The key is a keyed digest
// of the canvas id under the install's `ENCRYPTION_KEY`, so nothing is stored
// and only this install can mint or check one. Viewers open it on the viewer
// listener; the canvas's Yjs socket there carries the same key.
//
// Plain Node, no TS: the front server checks keys outside the app's bundles,
// and the app imports it to mint and check them too.

import { createHmac, timingSafeEqual } from "node:crypto"

/** Where a canvas link lives: `/s/<canvas id>/<key>`. */
export const SHARE_PREFIX = "/s/"

/** The search param the viewer's Yjs socket carries the key in. */
export const SHARE_KEY_PARAM = "key"

/** What the digest is of, so the key never matches another use of the secret. */
const PURPOSE = "screenplay canvas link v1"

/**
 * The canvas's key, or null when this install has no secret (only the Mac
 * app and Headless provision one).
 *
 * @param {string} roomId
 * @param {string | undefined} [secret]
 * @returns {string | null}
 */
export function shareKey(roomId, secret = process.env.ENCRYPTION_KEY) {
  if (!secret) return null
  return createHmac("sha256", secret)
    .update(`${PURPOSE}\0${roomId}`, "utf8")
    .digest("base64url")
    .slice(0, 32)
}

/**
 * The canvas link's path, or null without a secret.
 *
 * @param {string} roomId
 * @param {string | undefined} [secret]
 * @returns {string | null}
 */
export function sharePath(roomId, secret) {
  const key = shareKey(roomId, secret)
  if (!key) return null
  return `${SHARE_PREFIX}${encodeURIComponent(roomId)}/${key}`
}

/**
 * Whether `key` is the canvas's own.
 *
 * @param {string} roomId
 * @param {string | null | undefined} key
 * @param {string | undefined} [secret]
 */
export function isShareKey(roomId, key, secret) {
  const expected = shareKey(roomId, secret)
  if (!expected || !key) return false
  const a = Buffer.from(key)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * The canvas id and key a path under a canvas link names, unchecked, and the
 * rest of the path below `/s/<id>/<key>` ("" for the link itself), or null
 * for any other path.
 *
 * @param {string} pathname
 * @returns {{ roomId: string, key: string, rest: string } | null}
 */
export function parseSharePath(pathname) {
  if (!pathname.startsWith(SHARE_PREFIX)) return null
  const parts = pathname.slice(SHARE_PREFIX.length).split("/")
  if (parts.length < 2 || !parts[0] || !parts[1]) return null
  let roomId
  try {
    roomId = decodeURIComponent(parts[0])
  } catch {
    return null
  }
  return { roomId, key: parts[1], rest: parts.slice(2).join("/") }
}
