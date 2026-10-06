import Image from "@tiptap/extension-image"
import type { Editor, JSONContent } from "@tiptap/core"
import { NodeSelection, Selection, TextSelection } from "@tiptap/pm/state"

/**
 * **Document images**: a picture in a Document's body. Its `src` is the path
 * of one of the canvas's files (`uploads/sketch.png`), read through the
 * members-only files route when it's shown, or an `http(s)` URL an agent
 * wrote. The node is a block of its own, like a paragraph.
 *
 * Isomorphic: the editor adds a node view on top (`document-image-node.tsx`);
 * the server parses agents' markdown with this same node, so `![alt](path)`
 * round-trips through `replace_document_body`.
 */
export const DocumentImage = Image.extend({
  renderMarkdown: (node) =>
    documentImageMarkdown(
      (node.attrs?.src as string | null) ?? "",
      (node.attrs?.alt as string | null) ?? ""
    ),
})

/**
 * An image as markdown. A path with a space or bracket in it is wrapped in
 * `<…>`, which CommonMark reads as one destination.
 */
export function documentImageMarkdown(src: string, alt: string): string {
  const destination = /[\s()<>]/.test(src) ? `<${src}>` : src
  return `![${alt.replace(/[[\]]/g, "")}](${destination})`
}

/** Whether an image's `src` is a web address rather than a canvas file path. */
export function isWebImageSource(src: string): boolean {
  return /^https?:\/\//i.test(src)
}

/** The alt text a picked or uploaded file gets: its name without the extension. */
export function imageAltFor(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(0, dot) : name
}

/**
 * Markdown puts an image inside a paragraph, but a Document image is a block.
 * Split each paragraph holding one around it, dropping the empty halves, so
 * the parsed content fits the schema. A list item has to start with a
 * paragraph, so one that would lead with an image keeps an empty one.
 */
export function liftImagesFromParagraphs(node: JSONContent): JSONContent {
  if (!node.content) return node
  const content: JSONContent[] = []
  for (const child of node.content.map(liftImagesFromParagraphs)) {
    const hasImage =
      child.type === "paragraph" &&
      child.content?.some((c) => c.type === "image")
    if (!hasImage) {
      content.push(child)
      continue
    }
    let run: JSONContent[] = []
    const flush = () => {
      // Whitespace around an image on its own is markdown's line break, not
      // text worth a paragraph.
      if (run.some((c) => c.type !== "text" || c.text?.trim())) {
        content.push({ ...child, content: run })
      }
      run = []
    }
    for (const inline of child.content!) {
      if (inline.type === "image") {
        flush()
        content.push({ type: "image", attrs: inline.attrs })
      } else {
        run.push(inline)
      }
    }
    flush()
  }
  if (node.type === "listItem" && content[0]?.type !== "paragraph") {
    content.unshift({ type: "paragraph" })
  }
  return { ...node, content }
}

/**
 * Drop a selected image's selection, for when the Document stops editing.
 * ProseMirror keeps its selection through `setEditable(false)`, so a clicked
 * image would stay outlined after the layer is deselected. The caret moves to
 * the nearest text instead, which nothing shows while the Document isn't
 * editing.
 */
export function releaseImageSelection(editor: Editor): void {
  const { state } = editor
  if (!(state.selection instanceof NodeSelection)) return
  const $from = state.doc.resolve(state.selection.from)
  const text =
    TextSelection.findFrom($from, -1, true) ??
    TextSelection.findFrom($from, 1, true) ??
    Selection.atStart(state.doc)
  editor.view.dispatch(state.tr.setSelection(text))
}
