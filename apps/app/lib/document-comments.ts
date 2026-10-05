import * as Y from "yjs"
import type { Editor } from "@tiptap/core"
import { Fragment, Slice, type Node as PMNode } from "@tiptap/pm/model"
import { TextSelection } from "@tiptap/pm/state"
import { documentBodyMarkdown } from "@/lib/document-markdown"
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
 *  block boundaries: the words a comment quotes, without markdown. */
export function getQuotedText(doc: PMNode, from: number, to: number): string {
  return doc.textBetween(from, to, "\n", "\n")
}

/** Stand-ins for the two ends of a range while the body is serialized. */
const FROM_MARK = "\uE000"
const TO_MARK = "\uE001"

/**
 * 1-indexed body line numbers spanned by `[from, to]`, counted in the body's
 * markdown exactly as `read_document` returns it (`document-markdown.ts`), so
 * an agent finds “Line N” on line N of what it reads. The title heading isn't
 * part of the body: line 1 is the body's first line.
 */
export function getLineNumbers(
  doc: PMNode,
  from: number,
  to: number
): { lineFrom: number; lineTo: number } {
  const titleEnd = doc.firstChild ? doc.firstChild.nodeSize : 0
  // Mark both ends in the text (the later one first, so the earlier position
  // still holds), then find them in the serialized body.
  const marked = [
    [Math.max(to, titleEnd), TO_MARK],
    [Math.max(from, titleEnd), FROM_MARK],
  ].reduce<PMNode>(
    (d, [pos, mark]) => insertMark(d, pos as number, mark as string),
    doc
  )
  const markdown = documentBodyMarkdown(marked.toJSON())
  const lineOf = (mark: string) => {
    const at = markdown.indexOf(mark)
    return at < 0 ? 1 : markdown.slice(0, at).split("\n").length
  }
  const lineFrom = lineOf(FROM_MARK)
  return { lineFrom, lineTo: Math.max(lineOf(TO_MARK), lineFrom) }
}

/** `doc` with `mark` typed at `pos`, or the nearest place text can go. */
function insertMark(doc: PMNode, pos: number, mark: string): PMNode {
  const at = TextSelection.near(doc.resolve(Math.min(pos, doc.content.size)))
  try {
    return doc.replace(
      at.from,
      at.from,
      new Slice(Fragment.from(doc.type.schema.text(mark)), 0, 0)
    )
  } catch {
    return doc
  }
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
  // Block-quote each line of the captured text, ending all but the last with
  // a hard break (two trailing spaces) so the lines stay lines instead of
  // running together into one paragraph when the chat renders the markdown.
  const quoted = quotedText
    .split("\n")
    .map((l) => `> ${l}`)
    .join("  \n")
  return `**${where}**\n${quoted}`
}
