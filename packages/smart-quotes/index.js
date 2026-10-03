/**
 * Finds straight quotes (' and ") in the copy people read on the homepage and
 * in the docs, and works out the curly character each one should be: ’ for an
 * apostrophe, “ ” and ‘ ’ for quotes.
 *
 * Only prose is touched. In MDX that's text, a page's `title` and
 * `description`, and prose attributes on components; inline code, code blocks,
 * expressions and other attributes are left alone. In TSX it's JSX text,
 * `{"…"}` children and prose attributes (`alt`, `title`, `aria-label`, …). Any
 * other string literal is only checked for an apostrophe inside a word
 * (`it's`), which is never code.
 *
 * Each finding is an edit `{ start, end, text, line }` over the source, so the
 * same scan both reports and fixes (see `applyEdits`).
 */
import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkMdx from "remark-mdx"
import remarkFrontmatter from "remark-frontmatter"
import ts from "typescript"

/** Attributes whose value is shown to people (or read out by screen readers). */
export const PROSE_ATTRS = new Set([
  "alt",
  "aria-description",
  "aria-label",
  "aria-roledescription",
  "caption",
  "description",
  "label",
  "placeholder",
  "summary",
  "title",
])

/** Frontmatter fields that render: the page title and its description. */
const PROSE_FIELDS = new Set(["title", "description"])

/** HTML entities for straight quotes, as written in JSX text or MDX. */
const ENTITIES = {
  "&apos;": "'",
  "&#39;": "'",
  "&#x27;": "'",
  "&quot;": '"',
  "&#34;": '"',
  "&#x22;": '"',
}

// Markdown emphasis and code markers sit between a quote and the word it
// belongs to (`"**bold**"`), so context looks through them.
const MARKUP = new Set(["*", "_", "~", "`"])
// A quote after one of these opens.
const OPENS_AFTER = /[\s([{\-–—/“‘]/
// A quote before one of these closes.
const CLOSES_BEFORE = /[\s.,;:!?)\]}\-–—…<”’]/
const LETTER = /\p{L}/u
const WORD = /[\p{L}\p{N}]/u

/**
 * The quote marks in `src` between `start` and `end`, each as an edit to its
 * curly form. `isolated` spans (a string literal) take no context from
 * outside themselves; others (text in a paragraph) look past their ends.
 * `onlyInWord` keeps just apostrophes between two letters.
 */
export function quotesIn(
  src,
  start,
  end,
  { isolated = false, onlyInWord = false } = {}
) {
  const lo = isolated ? start : 0
  const hi = isolated ? end : src.length
  const edits = []
  for (let i = start; i < end; i++) {
    let mark = null
    let len = 1
    let from = i
    if (src[i] === "'" || src[i] === '"') {
      mark = src[i]
      // An escaped quote (`\"` in a string or in markdown) loses its backslash.
      if (i > start && src[i - 1] === "\\") from = i - 1
    } else if (src[i] === "&") {
      const entity = Object.keys(ENTITIES).find((e) => src.startsWith(e, i))
      if (entity && i + entity.length <= end) {
        mark = ENTITIES[entity]
        len = entity.length
      }
    }
    if (!mark) continue

    const prev = charBefore(src, from, lo)
    const next = charAfter(src, i + len, hi)
    const text = curl(mark, prev, next)
    if (
      onlyInWord &&
      !(mark === "'" && LETTER.test(prev ?? "") && LETTER.test(next ?? ""))
    ) {
      i += len - 1
      continue
    }
    edits.push({ start: from, end: i + len, text, line: lineOf(src, from) })
    i += len - 1
  }
  return edits
}

/** The curly form of `mark` between the characters `prev` and `next` (null at an edge). */
export function curl(mark, prev, next) {
  const opens =
    prev === null ||
    OPENS_AFTER.test(prev) ||
    // After a tag or expression (`</b>"`), a quote opens when a word follows.
    ((prev === ">" || prev === "}") &&
      next !== null &&
      !CLOSES_BEFORE.test(next))
  if (mark === '"') return opens ? "“" : "”"
  // A leading apostrophe before a digit drops numbers (’90s), not a quote.
  return opens && next !== null && LETTER.test(next) ? "‘" : "’"
}

function charBefore(src, i, lo) {
  let j = i - 1
  while (j >= lo && MARKUP.has(src[j])) j--
  return j >= lo ? src[j] : null
}

function charAfter(src, i, hi) {
  let j = i
  while (j < hi && MARKUP.has(src[j])) j++
  return j < hi ? src[j] : null
}

function lineOf(src, i) {
  let line = 1
  for (let j = 0; j < i; j++) if (src[j] === "\n") line++
  return line
}

/** Straight quotes in an MDX (or Markdown) page's prose. */
export function scanMdx(src) {
  const tree = unified()
    .use(remarkParse)
    .use(remarkMdx)
    .use(remarkFrontmatter)
    .parse(src)
  const edits = []
  walk(tree, (node) => {
    const pos = node.position
    if (!pos) return
    if (node.type === "text") {
      edits.push(...quotesIn(src, pos.start.offset, pos.end.offset))
    } else if (node.type === "yaml") {
      edits.push(...frontmatterQuotes(src, pos.start.offset, pos.end.offset))
    } else if (
      node.type === "mdxJsxAttribute" &&
      typeof node.value === "string" &&
      PROSE_ATTRS.has(node.name)
    ) {
      const slice = src.slice(pos.start.offset, pos.end.offset)
      const eq = slice.indexOf("=")
      const open = pos.start.offset + eq + 1
      edits.push(
        ...quotesIn(src, open + 1, pos.end.offset - 1, { isolated: true })
      )
    }
  })
  return edits
}

function frontmatterQuotes(src, start, end) {
  const edits = []
  const field = /^([A-Za-z]+):[ \t]*(.*)$/gm
  const block = src.slice(start, end)
  for (const m of block.matchAll(field)) {
    if (!PROSE_FIELDS.has(m[1])) continue
    const value = m[2]
    let from = start + m.index + m[0].length - value.length
    let to = from + value.length
    // A quoted YAML scalar keeps its delimiters.
    const delim = value[0]
    if (
      (delim === '"' || delim === "'") &&
      value.endsWith(delim) &&
      value.length > 1
    ) {
      from += 1
      to -= 1
    }
    edits.push(...quotesIn(src, from, to, { isolated: true }))
  }
  return edits
}

function walk(node, visit) {
  visit(node)
  for (const child of [...(node.attributes ?? []), ...(node.children ?? [])])
    walk(child, visit)
}

/** Straight quotes in a TSX or TS file's copy. */
export function scanTsx(src, fileName = "file.tsx") {
  const kind = fileName.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.TSX
  const file = ts.createSourceFile(
    fileName,
    src,
    ts.ScriptTarget.Latest,
    true,
    kind
  )
  const edits = []
  const visit = (node) => {
    if (ts.isJsxText(node)) {
      edits.push(...quotesIn(src, node.pos, node.end))
    } else if (isStringish(node)) {
      const start = node.getStart() + 1
      const end =
        node.getEnd() -
        (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) ? 2 : 1)
      edits.push(
        ...quotesIn(src, start, end, {
          isolated: true,
          onlyInWord: !isProse(node),
        })
      )
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return edits
}

function isStringish(node) {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  )
}

// A string shown as is: a prose attribute's value or a `{"…"}` child.
function isProse(node) {
  const parent = node.parent
  if (ts.isJsxAttribute(parent)) return PROSE_ATTRS.has(parent.name.getText())
  if (ts.isJsxExpression(parent)) {
    const owner = parent.parent
    if (ts.isJsxAttribute(owner)) return PROSE_ATTRS.has(owner.name.getText())
    return ts.isJsxElement(owner) || ts.isJsxFragment(owner)
  }
  return false
}

/** Straight quotes in a file, by its extension. */
export function scan(src, fileName) {
  return /\.mdx?$/.test(fileName) ? scanMdx(src) : scanTsx(src, fileName)
}

/** `src` with `edits` applied. */
export function applyEdits(src, edits) {
  let out = src
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end)
  }
  return out
}
