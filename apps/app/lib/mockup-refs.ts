import { normalizeFilePath } from "@/lib/files/paths"

/**
 * **Mockup references** (#1643): a Mockup page may name a file instead of
 * holding it, so big template code and screenshots stay out of the room doc.
 * A `src` or `href` attribute may be
 *
 * - `skill:<skill>/<path>`: a supporting file of a Skill the canvas can see,
 *   resolved by the Skill precedence (repo, canvas, account, App), or
 * - `files:<path>`: a canvas File, e.g. a screenshot `screenshot_page` saved.
 *
 * The page text keeps the references; the canvas resolves them when it builds
 * the page's srcdoc (`mockupSrcDoc`), where each becomes a `blob:` URL made
 * inside the page's own frame, so nothing loads from the network.
 */

export type MockupRef =
  | { kind: "skill"; skill: string; path: string }
  | { kind: "files"; path: string }

/**
 * A resolved reference: its media type and its bytes as base64. `null` is a
 * reference that couldn't resolve, which the page gets as an empty resource.
 */
export type MockupResource = { type: string; data: string }

export type MockupResources = Readonly<Record<string, MockupResource | null>>

/** The most references one page resolves; any more render empty. */
export const MAX_MOCKUP_REFS = 64

/**
 * The most bytes one page's references resolve to, together: under the live
 * page's message cap (8 MB) once base64 grows them by a third.
 */
export const MAX_MOCKUP_REF_BYTES = 5 * 1024 * 1024

// A `src` or `href` attribute (or `xlink:href`) whose value is a reference,
// double-quoted, single-quoted or bare. The lookbehind keeps `data-src` out.
const REF_ATTRIBUTE =
  /(?<=[\s"'/])((?:xlink:)?(?:src|href)\s*=\s*)(?:"((?:skill|files):[^"]*)"|'((?:skill|files):[^']*)'|((?:skill|files):[^\s"'=<>`]+))/gi

/** Every reference `html` names in a `src` or `href`, once each, in order. */
export function mockupRefs(html: string): string[] {
  const refs = new Set<string>()
  for (const m of html.matchAll(REF_ATTRIBUTE)) refs.add(m[2] ?? m[3] ?? m[4]!)
  return [...refs]
}

/**
 * `html` with each reference attribute's value replaced by `swap(ref)`, kept
 * in the same quotes (a bare value comes back double-quoted).
 */
export function swapMockupRefs(
  html: string,
  swap: (ref: string) => string
): string {
  return html.replace(
    REF_ATTRIBUTE,
    (_, name: string, dq?: string, sq?: string, bare?: string) => {
      const ref = (dq ?? sq ?? bare)!
      const value = swap(ref)
      return sq !== undefined ? `${name}'${value}'` : `${name}"${value}"`
    }
  )
}

/** What a reference names, or null when it isn't a well-formed one. */
export function parseMockupRef(ref: string): MockupRef | null {
  const colon = ref.indexOf(":")
  const scheme = ref.slice(0, colon)
  let rest: string
  try {
    rest = decodeURIComponent(ref.slice(colon + 1))
  } catch {
    return null
  }
  if (scheme === "files") {
    const normal = normalizeFilePath(rest)
    return "path" in normal ? { kind: "files", path: normal.path } : null
  }
  if (scheme === "skill") {
    const slash = rest.indexOf("/")
    if (slash <= 0) return null
    const skill = rest.slice(0, slash)
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(skill)) return null
    const normal = normalizeFilePath(rest.slice(slash + 1))
    return "path" in normal ? { kind: "skill", skill, path: normal.path } : null
  }
  return null
}
