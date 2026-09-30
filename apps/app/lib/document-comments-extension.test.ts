// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { Editor } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"

import {
  DocumentCommentsExtension,
  setDocumentCommentRanges,
} from "./document-comments-extension"

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

function mount() {
  editor = new Editor({
    extensions: [StarterKit, DocumentCommentsExtension],
    content: "<p>Does Apple Pay sit above the card form?</p>",
  })
  return editor
}

describe("DocumentCommentsExtension", () => {
  it("paints a thread's range as a clickable highlight", () => {
    const ed = mount()
    setDocumentCommentRanges(ed.view, [{ id: "t1", from: 1, to: 5 }])
    const span = ed.view.dom.querySelector(".doc-comment-highlight")
    expect(span?.textContent).toBe("Does")
    expect(span?.getAttribute("data-comment-thread")).toBe("t1")
    expect(span?.classList.contains("doc-comment-highlight-active")).toBe(false)
  })

  it("paints a pending range in the active colour with no thread to open", () => {
    const ed = mount()
    setDocumentCommentRanges(ed.view, [
      { id: "draft", from: 1, to: 5, pending: true },
    ])
    const span = ed.view.dom.querySelector(".doc-comment-highlight-active")
    expect(span?.textContent).toBe("Does")
    expect(span?.hasAttribute("data-comment-thread")).toBe(false)

    setDocumentCommentRanges(ed.view, [])
    expect(ed.view.dom.querySelector(".doc-comment-highlight")).toBeNull()
  })
})
