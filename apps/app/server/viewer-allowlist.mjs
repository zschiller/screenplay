// What a viewer listener serves (#1931): this list and nothing else. A
// request no entry allows is refused before Next sees it: a write with 403,
// a read with 404 once the viewer is identified (or the refused page when
// they aren't). Sharing's later pieces add their entries here: the canvas
// link (#1932), chats (#1933) and comments (#1934), the only write.
//
// Plain Node, no TS: the front server loads it outside the app's bundles.

/**
 * @typedef {{
 *   name: string
 *   methods: string[]
 *   identify: boolean
 *   match: (pathname: string) => boolean
 *   example: string
 * }} AllowlistEntry
 */

/** @type {AllowlistEntry[]} */
export const VIEWER_ALLOWLIST = [
  {
    // Scripts, styles and fonts, the refused page's included: public, so
    // served before identity.
    name: "app assets",
    methods: ["GET", "HEAD"],
    identify: false,
    match: (pathname) => pathname.startsWith("/_next/static/"),
    example: "/_next/static/chunks/app.js",
  },
  {
    name: "app icon",
    methods: ["GET", "HEAD"],
    identify: false,
    match: (pathname) => pathname === "/icon",
    example: "/icon",
  },
]

/** The entry `pathname` falls under, if any. */
export function allowlistEntry(pathname, allowlist = VIEWER_ALLOWLIST) {
  return allowlist.find((entry) => entry.match(pathname))
}
