// Assembles a template's HTML page, the same way for the dev server and the
// build: a readable top (title, fonts, tokens, the data script an agent fills)
// above the MARKER line, then the generated bundle. Agents read and edit only
// the top, so it stays short and plain.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import postcss, { type Rule } from "postcss"

export const MARKER =
  "<!-- Generated below this line by packages/skill-templates: the built page. Never read or edit it; fill the data script above, or change the source there and rebuild. -->"

// The app's type voice (apps/app/app/layout.tsx): Instrument Sans for UI,
// Unbounded for titles, Geist Mono for labels and code. src/styles.css points
// font-sans, font-heading and font-mono at these variables.
const FONTS =
  '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500;600&family=Instrument+Sans:wdth,wght@75..100,400..700&family=Unbounded:wght@400&display=swap">'
const FONT_TOKENS = `:root{--font-ui:"Instrument Sans",ui-sans-serif,system-ui,sans-serif;--font-title:"Unbounded",ui-sans-serif,system-ui,sans-serif;--font-code:"Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace}`

const TOKENS_CSS = fileURLToPath(
  new URL("../../ui/src/styles/tokens.css", import.meta.url)
)

const isTokenRule = (rule: Rule) =>
  rule.parent?.type === "root" &&
  /^(:root|\.dark)\b/.test(rule.selector.trim()) &&
  rule.nodes.every((n) => n.type !== "decl" || n.prop.startsWith("--"))

/**
 * The light and dark token values from packages/ui, one rule per line, keeping
 * only the variables `css` reads (all of them without it, as in dev). Agents
 * swap these for another repo's brand.
 */
export function tokenBlock(css?: string) {
  const used = css ? new Set(css.match(/--[\w-]+/g)) : null
  const rules: string[] = []
  postcss.parse(readFileSync(TOKENS_CSS, "utf8")).walkRules((rule) => {
    if (!isTokenRule(rule)) return
    const decls = rule.nodes.flatMap((n) =>
      n.type === "decl" && (!used || used.has(n.prop))
        ? [`${n.prop}:${n.value}`]
        : []
    )
    const selector = rule.selector.replace(/\s*,\s*/g, ",")
    if (decls.length) rules.push(`${selector}{${decls.join(";")}}`)
  })
  return [FONT_TOKENS, ...rules].join("\n")
}

/**
 * PostCSS plugin that drops the token rules from the bundle's CSS, in dev and
 * in the build, so the readable block above MARKER is their only source.
 */
export const stripTokens = {
  postcssPlugin: "strip-tokens",
  OnceExit(root: postcss.Root) {
    // The dev page's own token block goes through PostCSS too; keep it
    if (root.source?.input.file?.includes("html-proxy")) return
    root.walkRules((rule) => {
      if (isTokenRule(rule)) rule.remove()
    })
  },
}

export type PageParts = {
  title: string
  /** One comment line on what the page is and how to fill it. */
  about: string
  data: string
  tokens: string
  /** Everything under MARKER: the bundle's style, mount point and script. */
  body: string
  /**
   * A page for a Mockup, which loads nothing from the network: no font link
   * (the fallback fonts stand in) and no brand swapping, since an App Skill's
   * template keeps the Screenplay look.
   */
  mockup?: boolean
}

export function assemble({
  title,
  about,
  data,
  tokens,
  body,
  mockup,
}: PageParts) {
  return [
    `<title>${title}</title>`,
    mockup
      ? `<!-- ${about} -->`
      : `<!-- ${about} Swap the tokens and the font link for the repo's brand; they use shadcn's variable names. -->`,
    ...(mockup ? [] : [FONTS]),
    `<style>\n${tokens}\n</style>`,
    `<script>\n${data.trim()}\n</script>`,
    MARKER,
    body,
  ].join("\n")
}
