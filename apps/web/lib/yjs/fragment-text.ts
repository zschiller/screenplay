import * as Y from "yjs"

/**
 * Serialize a TipTap-managed Y.XmlFragment to plain text. Walks the fragment
 * tree and joins paragraphs / list items / etc. with newlines so the result
 * reads cleanly when handed to an LLM as context. Mirrors the rendering used
 * for thumbnails (`fragmentToText` in `app/[roomId]/render/page.tsx`) so the
 * client and the render pipeline agree on what "the document body" is.
 */
export function fragmentToPlainText(node: Y.XmlFragment | Y.XmlElement): string {
  const lines: string[] = []
  collectLines(node, lines)
  return lines.join("\n").trim()
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
