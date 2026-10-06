import { describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"

import { editorAwareness } from "./editor-awareness"

function setup() {
  const awareness = new Awareness(new Y.Doc())
  const editor = editorAwareness(awareness)
  const onChange = vi.fn()
  const onUpdate = vi.fn()
  editor.on("change", onChange)
  editor.on("update", onUpdate)
  return { awareness, editor, onChange, onUpdate }
}

describe("editorAwareness", () => {
  it("passes on a caret or name change", () => {
    const { awareness, onChange, onUpdate } = setup()
    awareness.setLocalStateField("user", { name: "Ada" })
    awareness.setLocalStateField("cursor", { anchor: 1, head: 1 })
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onUpdate).toHaveBeenCalledTimes(2)
  })

  it("keeps a pointer move to itself", () => {
    const { awareness, onChange, onUpdate } = setup()
    awareness.setLocalStateField("user", { name: "Ada" })
    onChange.mockClear()
    onUpdate.mockClear()
    awareness.setLocalStateField("pointer", { x: 1, y: 2 })
    awareness.setLocalStateField("pointer", { x: 3, y: 4 })
    expect(onChange).not.toHaveBeenCalled()
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it("stops calling a listener taken off", () => {
    const { awareness, editor, onChange } = setup()
    editor.off("change", onChange)
    awareness.setLocalStateField("cursor", { anchor: 2, head: 2 })
    expect(onChange).not.toHaveBeenCalled()
  })

  it("reads and writes through to the awareness", () => {
    const { awareness, editor } = setup()
    editor.setLocalStateField("cursor", { anchor: 3, head: 3 })
    expect(awareness.getLocalState()?.cursor).toEqual({ anchor: 3, head: 3 })
    expect(editor.getStates()).toBe(awareness.getStates())
    expect(editor.clientID).toBe(awareness.clientID)
  })
})
