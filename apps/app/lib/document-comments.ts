import * as Y from "yjs"
import type { Editor } from "@tiptap/core"
import type { Node as PMNode } from "@tiptap/pm/model"
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from "@tiptap/y-tiptap"

/**
 * Encode a ProseMirror position as a serialized Y.RelativePosition. The
 * returned string is durable: it survives concurrent edits because the
 * underlying RelativePosition is bound to a Yjs item ID, not a numeric
 * offset. Returns null if the editor isn't bound to a Yjs sync plugin or
 * the position can't be mapped.
 */
export function encodeAnchor(editor: Editor, pmPos: number): string | null {
  const sync = ySyncPluginKey.getState(editor.state)
  if (!sync) return null
  const fragment: Y.XmlFragment | undefined = sync.binding?.type ?? sync.type
  if (!fragment) return null
  const mapping = sync.binding?.mapping ?? sync.mapping
  if (!mapping) return null
  const rel = absolutePositionToRelativePosition(pmPos, fragment, mapping)
  if (!rel) return null
  return JSON.stringify(Y.relativePositionToJSON(rel))
}

/**
 * Resolve a serialized Y.RelativePosition back to a current ProseMirror
 * position. Returns null when the anchor's content has been fully removed
 * (the relative position has nothing to anchor to anymore).
 */
export function decodeAnchor(editor: Editor, encoded: string): number | null {
  const sync = ySyncPluginKey.getState(editor.state)
  if (!sync) return null
  const fragment: Y.XmlFragment | undefined = sync.binding?.type ?? sync.type
  const doc = fragment?.doc
  if (!fragment || !doc) return null
  const mapping = sync.binding?.mapping ?? sync.mapping
  if (!mapping) return null
  let json: unknown
  try {
    json = JSON.parse(encoded)
  } catch {
    return null
  }
  const rel = Y.createRelativePositionFromJSON(json as never)
  return relativePositionToAbsolutePosition(doc, fragment, rel, mapping)
}

/** Plain-text content between two ProseMirror positions, with `\n` between
 *  block boundaries — same flavor used by `fragmentBodyToPlainText` so the
 *  quoted text matches what an LLM sees as the document body. */
export function getQuotedText(doc: PMNode, from: number, to: number): string {
  return doc.textBetween(from, to, "\n", "\n")
}

/**
 * 1-indexed body line numbers spanned by `[from, to]`. The title heading
 * (the doc's first child) is excluded — line 1 is the first body block.
 * Each top-level textblock counts as one line. Code blocks expand to one
 * line per `\n` in their text, matching how the user reads them.
 */
export function getLineNumbers(
  doc: PMNode,
  from: number,
  to: number
): { lineFrom: number; lineTo: number } {
  const titleEnd = doc.firstChild ? doc.firstChild.nodeSize : 0
  const fromBody = Math.max(from, titleEnd)
  const toBody = Math.max(to, titleEnd)

  let line = 0
  let lineFrom = 1
  let lineTo = 1

  doc.descendants((node, pos) => {
    if (pos < titleEnd) return false
    if (!node.isTextblock) return true

    const blockStart = pos
    const blockEnd = pos + node.nodeSize
    const internalLines =
      node.type.name === "codeBlock"
        ? Math.max(1, (node.textContent.match(/\n/g)?.length ?? 0) + 1)
        : 1

    if (fromBody >= blockStart && fromBody <= blockEnd) {
      const before = node.textContent.slice(0, fromBody - blockStart - 1)
      lineFrom = line + 1 + (before.match(/\n/g)?.length ?? 0)
    }
    if (toBody >= blockStart && toBody <= blockEnd) {
      const before = node.textContent.slice(0, toBody - blockStart - 1)
      lineTo = line + 1 + (before.match(/\n/g)?.length ?? 0)
    }

    line += internalLines
    return false
  })

  return { lineFrom, lineTo: Math.max(lineTo, lineFrom) }
}

/** Format a quote + line range for inclusion in a chat message to Claude. */
export function formatQuoteForChat(opts: {
  quotedText: string
  lineFrom: number
  lineTo: number
  documentTitle?: string | null
}): string {
  const { quotedText, lineFrom, lineTo, documentTitle } = opts
  const range =
    lineFrom === lineTo ? `Line ${lineFrom}` : `Lines ${lineFrom}–${lineTo}`
  const where = documentTitle ? `${documentTitle} · ${range}` : range
  // Block-quote each line of the captured text so multi-line quotes render
  // cleanly in markdown.
  const quoted = quotedText
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n")
  return `**${where}**\n${quoted}`
}
