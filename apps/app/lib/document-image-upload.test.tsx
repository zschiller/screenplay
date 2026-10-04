// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import Document from "@tiptap/extension-document"
import { DocumentImage } from "@/lib/document-image"
import {
  DocumentImageUpload,
  insertImageAt,
  insertImageWhenSaved,
  markPlace,
  releasePlace,
  type SavedImage,
} from "@/lib/document-image-upload"

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

/** An editor shaped like a Document's: a title heading, then blocks. */
function documentEditor(html: string) {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      StarterKit.configure({ document: false, trailingNode: false }),
      Document.extend({ content: "heading block*" }),
      DocumentImage,
      DocumentImageUpload,
    ],
    content: html,
  })
  return editor
}

const blocks = (e: Editor) =>
  e
    .getJSON()
    .content!.map((n) =>
      n.type === "image" ? `image:${n.attrs!.src}` : n.type!
    )

/** The position at the end of the body block at `index`. */
const endOf = (e: Editor, index: number) => {
  let pos = 0
  for (let i = 0; i <= index; i++) pos += e.state.doc.child(i).nodeSize
  return pos - 1
}

describe("insertImageAt", () => {
  it("puts the image after the title, never in it", () => {
    const e = documentEditor("<h1>Plan</h1><p>Body</p>")
    e.view.dispatch(insertImageAt(e.state.tr, 2, { src: "a.png", alt: "a" }))

    expect(blocks(e)).toEqual(["heading", "image:a.png", "paragraph"])
  })

  it("replaces an empty paragraph", () => {
    const e = documentEditor("<h1>Plan</h1><p>Body</p><p></p><p>End</p>")
    e.view.dispatch(
      insertImageAt(e.state.tr, endOf(e, 2), { src: "a.png", alt: "a" })
    )

    expect(blocks(e)).toEqual([
      "heading",
      "paragraph",
      "image:a.png",
      "paragraph",
    ])
  })

  it("leaves a paragraph after an image that ends the Document", () => {
    const e = documentEditor("<h1>Plan</h1><p>Body</p>")
    e.view.dispatch(
      insertImageAt(e.state.tr, endOf(e, 1), { src: "a.png", alt: "a" })
    )

    expect(blocks(e)).toEqual([
      "heading",
      "paragraph",
      "image:a.png",
      "paragraph",
    ])
  })
})

describe("insertImageWhenSaved", () => {
  it("holds a spinner where the image goes, then puts the image there", async () => {
    const e = documentEditor("<h1>Plan</h1><p>One</p><p>Two</p>")
    let save!: (saved: SavedImage) => void
    const done = insertImageWhenSaved(
      e,
      new Promise<SavedImage>((resolve) => (save = resolve)),
      { pos: endOf(e, 1), label: "sketch.png", onError: vi.fn() }
    )

    await vi.waitFor(() =>
      expect(e.view.dom.textContent).toContain("Uploading sketch.png…")
    )
    // Someone types above it meanwhile: the place moves with the text.
    e.commands.insertContentAt(1, "My ")
    save({ ok: true, path: "uploads/sketch.png" })
    await done

    expect(blocks(e)).toEqual([
      "heading",
      "paragraph",
      "image:uploads/sketch.png",
      "paragraph",
    ])
    expect(e.getJSON().content![2]!.attrs!.alt).toBe("sketch")
    expect(e.view.dom.textContent).not.toContain("Uploading")
  })

  it("takes the spinner away and says why when the save fails", async () => {
    const e = documentEditor("<h1>Plan</h1><p>One</p>")
    const onError = vi.fn()
    await insertImageWhenSaved(
      e,
      Promise.resolve({ ok: false as const, error: "Too big." }),
      { pos: endOf(e, 1), label: "huge.png", onError }
    )

    expect(onError).toHaveBeenCalledWith("Too big.")
    expect(blocks(e)).toEqual(["heading", "paragraph"])
    expect(e.view.dom.textContent).not.toContain("Uploading")
  })
})

describe("markPlace", () => {
  it("answers where a held place moved to", () => {
    const e = documentEditor("<h1>Plan</h1><p>One</p>")
    const id = markPlace(e, endOf(e, 1), null)
    e.commands.insertContentAt(1, "My ")

    expect(releasePlace(e, id)).toBe(endOf(e, 1))
    expect(releasePlace(e, id)).toBeNull()
  })
})
