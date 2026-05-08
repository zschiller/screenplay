import * as Y from "yjs"

/**
 * Serialize a TipTap-managed Y.XmlFragment to plain text. Walks the fragment
 * tree and joins paragraphs / list items / etc. with newlines so the result
 * reads cleanly when handed to an LLM as context. Mirrors the rendering used
 * for thumbnails (`fragmentToText` in `app/[roomId]/render/page.tsx`) so the
 * client and the render pipeline agree on what "the document body" is.
 *
 * The reverse direction — `writeMarkdownToFragment` — accepts the same
 * format the agent emits (plain text with `# heading` / `- list` cues),
 * parses it into TipTap-compatible XmlElement nodes, and replaces the
 * fragment's contents in a single Yjs transaction. Lossy on round-trip
 * (we don't preserve marks like bold/italic) but enough for an agent to
 * rewrite a document body via natural-language tool calls.
 */
export function fragmentToPlainText(node: Y.XmlFragment | Y.XmlElement): string {
  const lines: string[] = []
  collectLines(node, lines)
  return lines.join("\n").trim()
}

/**
 * Replace the contents of a Y.XmlFragment with TipTap-compatible XmlElement
 * nodes derived from a small flavor of markdown:
 *  - blank line → block separator
 *  - `# `..`###### ` → heading (level 1–6)
 *  - lines starting with `- ` or `* ` → bulletList (one item per line)
 *  - everything else → paragraph (multi-line joined with hardBreak)
 *
 * Designed to be fed by an agent that emits a freshly-rewritten document
 * body. The whole replacement runs inside one `doc.transact()` so peers see
 * a single update on the wire and a single undo step.
 */
export function writeMarkdownToFragment(
  fragment: Y.XmlFragment,
  text: string,
): void {
  const doc = fragment.doc
  if (!doc) return
  doc.transact(() => {
    while (fragment.length > 0) fragment.delete(0, 1)

    const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/)
    for (const block of blocks) {
      const trimmed = block.replace(/^\n+|\n+$/g, "")
      if (trimmed.length === 0) continue

      // Heading — single-line block prefixed with up to six `#`.
      const headingMatch = /^(#{1,6}) +(.*)$/.exec(trimmed)
      if (headingMatch && !trimmed.includes("\n")) {
        const level = headingMatch[1]!.length
        const heading = new Y.XmlElement("heading")
        heading.setAttribute("level", String(level))
        const t = new Y.XmlText()
        t.insert(0, headingMatch[2]!)
        heading.insert(0, [t])
        fragment.push([heading])
        continue
      }

      const lines = trimmed.split("\n")
      // Bullet list — every line starts with `- ` or `* `.
      if (lines.length > 0 && lines.every((l) => /^[-*] /.test(l))) {
        const ul = new Y.XmlElement("bulletList")
        for (const line of lines) {
          const item = new Y.XmlElement("listItem")
          const para = new Y.XmlElement("paragraph")
          const inner = line.replace(/^[-*] /, "")
          if (inner.length > 0) {
            const t = new Y.XmlText()
            t.insert(0, inner)
            para.insert(0, [t])
          }
          item.insert(0, [para])
          ul.insert(ul.length, [item])
        }
        fragment.push([ul])
        continue
      }

      // Plain paragraph — preserve internal newlines as hardBreak so the
      // agent can emit multi-line stanzas without forcing a paragraph break.
      const para = new Y.XmlElement("paragraph")
      let pos = 0
      lines.forEach((line, i) => {
        if (i > 0) {
          const br = new Y.XmlElement("hardBreak")
          para.insert(pos++, [br])
        }
        if (line.length > 0) {
          const t = new Y.XmlText()
          t.insert(0, line)
          para.insert(pos++, [t])
        }
      })
      fragment.push([para])
    }

    // Always end with at least one empty paragraph so the editor has a
    // valid cursor position when the body is "empty".
    if (fragment.length === 0) {
      fragment.push([new Y.XmlElement("paragraph")])
    }
  })
}

function collectLines(
  node: Y.XmlFragment | Y.XmlElement,
  out: string[],
): void {
  const len = node.length
  for (let i = 0; i < len; i++) {
    const child = node.get(i)
    if (child instanceof Y.XmlText) {
      // Each top-level XmlText goes on its own line so adjacent paragraphs
      // don't run together.
      const t = child.toString()
      if (t.length > 0) out.push(t)
    } else if (child instanceof Y.XmlElement) {
      // Mention nodes are inline and carry their text in attrs (TipTap's
      // Mention extension stores the picked label there, not as XmlText
      // children). Render them as `@<label>` so the agent sees the
      // human-readable reference.
      if (child.nodeName === "mention") {
        const attrs = child.getAttributes() as Record<string, unknown>
        const label = (attrs.label as string | undefined) ?? (attrs.id as string | undefined)
        if (label) out.push(`@${label}`)
        continue
      }
      // Block-level elements (paragraph, heading, listItem, etc.) collect
      // their own line; inline elements just contribute text.
      const before = out.length
      collectLines(child, out)
      // Add an empty line after blockquote / heading / paragraph blocks to
      // visually separate them, matching common markdown spacing.
      if (
        out.length > before &&
        (child.nodeName === "paragraph" ||
          child.nodeName === "heading" ||
          child.nodeName === "blockquote" ||
          child.nodeName === "codeBlock")
      ) {
        // Push a soft break — collapsed at the end via `.trim()` if trailing.
        out.push("")
      }
    }
  }
}
