// What a viewer listener serves (#1931): this list and nothing else. A
// request no entry allows is refused before Next sees it: a write with 403,
// a read with 404 once the viewer is identified (or the refused page when
// they aren't). Sharing's pieces add their entries here: the canvas link
// (#1932), chats (#1933) and comments (#1934). Comments are the only write:
// no other entry may allow a method but GET and HEAD.
//
// Plain Node, no TS: the front server loads it outside the app's bundles.

import { parseSharePath } from "./share-link.mjs"

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
    // The canvas a viewer watches (#1932). The page checks the key and finds
    // nothing for a wrong one; its Yjs socket is checked here, in the front
    // server.
    name: "canvas link",
    methods: ["GET", "HEAD"],
    identify: true,
    match: (pathname) => parseSharePath(pathname)?.rest === "",
    example: "/s/room-1/key",
  },
  {
    // What a viewer's canvas reads below its link, each checking the key:
    // where a frame loads its preview, a Mockup's page, and the script
    // Mockup pages run first.
    name: "canvas link reads",
    methods: ["GET", "HEAD"],
    identify: true,
    match: (pathname) => {
      const rest = parseSharePath(pathname)?.rest
      return (
        rest === "preview" ||
        rest === "mockup-runtime" ||
        /^mockups\/[^/]+$/.test(rest ?? "")
      )
    },
    example: "/s/room-1/key/mockups/file-1",
  },
  {
    // A viewer's comments on the canvas (#1934): the threads, and the one
    // write a viewer makes. The route checks the key and the origin, and
    // runs each operation as the viewer.
    name: "comments",
    methods: ["GET", "HEAD", "POST"],
    identify: true,
    match: (pathname) => parseSharePath(pathname)?.rest === "comments",
    example: "/s/room-1/key/comments",
  },
  {
    // A Mockup page's own files, behind a token signed for one Mockup.
    name: "mockup pages",
    methods: ["GET", "HEAD"],
    identify: true,
    match: (pathname) => pathname.startsWith("/api/mockup-pages/"),
    example: "/api/mockup-pages/token/r1/index.html",
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
