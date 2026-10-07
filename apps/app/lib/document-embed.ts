import type { Editor } from "@tiptap/core"
import { documentImageMarkdown } from "@/lib/document-image"

/**
 * **Mockup embeds** (#1888, spec #1882): a Mockup shown live inside a
 * Document, another view of its file. It's written like a Document image
 * with a mockup URL in place of a path, `![Option B](mockup:<id>)`, the same
 * `mockup:<id>` link a chat reply names a Mockup by. So it's the image node
 * (`document-image.ts`) with a `mockup:` source: it round-trips through the
 * agent's markdown as is, and deleting the block removes only that view.
 *
 * Isomorphic: the editor's node view and the agent tools both use it.
 */

const PREFIX = "mockup:"

/** The Mockup an image's `src` embeds (a view's id or its file's), or null. */
export function mockupEmbedId(src: string | null | undefined): string | null {
  if (!src?.startsWith(PREFIX)) return null
  const id = src.slice(PREFIX.length).trim()
  return id || null
}

/** The `src` that embeds a Mockup. */
export function mockupEmbedSrc(id: string): string {
  return `${PREFIX}${id}`
}

/** An embed as markdown: `![<name>](mockup:<id>)`. */
export function mockupEmbedMarkdown(id: string, name: string): string {
  return documentImageMarkdown(mockupEmbedSrc(id), name)
}

/** A top-level block of a Document as laid out: where it starts and its box. */
export type LaidOutBlock = { pos: number; top: number; bottom: number }

/**
 * Where a drop at `y` puts a new block (#1888): the gap between top-level
 * blocks nearest the pointer, never above the title (the first block). `y`
 * is the line the gap sits on, between the two blocks it parts.
 */
export function blockGapAt(
  blocks: readonly LaidOutBlock[],
  end: number,
  y: number
): { pos: number; y: number } | null {
  const body = blocks.slice(1)
  const title = blocks[0]
  if (!title) return null
  for (const [i, block] of body.entries()) {
    if (y < (block.top + block.bottom) / 2) {
      const above = i === 0 ? title : body[i - 1]!
      return { pos: block.pos, y: (above.bottom + block.top) / 2 }
    }
  }
  const last = body.at(-1) ?? title
  return { pos: end, y: last.bottom }
}

/** The editor's top-level blocks, measured on screen. */
export function laidOutBlocks(editor: Editor): LaidOutBlock[] {
  const blocks: LaidOutBlock[] = []
  editor.state.doc.forEach((_node, offset) => {
    const dom = editor.view.nodeDOM(offset)
    if (!(dom instanceof HTMLElement)) return
    const rect = dom.getBoundingClientRect()
    blocks.push({ pos: offset, top: rect.top, bottom: rect.bottom })
  })
  return blocks
}

/** Put an embed of the Mockup into the Document at `pos`, a block gap. */
export function insertMockupEmbed(
  editor: Editor,
  pos: number,
  id: string,
  name: string
): void {
  editor
    .chain()
    .insertContentAt(pos, {
      type: "image",
      attrs: { src: mockupEmbedSrc(id), alt: name },
    })
    .run()
}
