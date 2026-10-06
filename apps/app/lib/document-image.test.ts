// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import Document from "@tiptap/extension-document"
import { NodeSelection, TextSelection } from "@tiptap/pm/state"
import { DocumentImage, releaseImageSelection } from "@/lib/document-image"

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
    ],
    content: html,
  })
  return editor
}

/** Select the first image, as clicking it while editing does. */
function selectImage(e: Editor) {
  let at = -1
  e.state.doc.forEach((node, offset) => {
    if (at < 0 && node.type.name === "image") at = offset
  })
  e.view.dispatch(
    e.state.tr.setSelection(NodeSelection.create(e.state.doc, at))
  )
}

describe("releaseImageSelection", () => {
  it("moves a selected image's selection to the text before it", () => {
    const e = documentEditor(
      '<h1>Plan</h1><p>Before</p><img src="a.png"><p>After</p>'
    )
    selectImage(e)
    e.setEditable(false)
    releaseImageSelection(e)

    expect(e.state.selection).toBeInstanceOf(TextSelection)
    expect(e.state.doc.resolve(e.state.selection.from).parent.textContent).toBe(
      "Before"
    )
  })

  it("finds text after the image when there's none before it", () => {
    const e = documentEditor('<h1></h1><img src="a.png"><p>After</p>')
    selectImage(e)
    releaseImageSelection(e)

    expect(e.state.selection).toBeInstanceOf(TextSelection)
  })

  it("leaves a text selection alone", () => {
    const e = documentEditor('<h1>Plan</h1><p>Body</p><img src="a.png">')
    e.commands.setTextSelection({ from: 8, to: 10 })
    releaseImageSelection(e)

    expect(e.state.selection.from).toBe(8)
    expect(e.state.selection.to).toBe(10)
  })
})
