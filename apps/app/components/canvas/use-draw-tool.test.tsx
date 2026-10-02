// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useState } from "react"

import { useDrawTool } from "./use-draw-tool"
import { useToolMode } from "./use-tool-mode"
import type { ToolMode } from "@/lib/canvas/tool-mode"

function setup(armed: ToolMode) {
  const onFrameDrawn = vi.fn()
  const addFrame = vi.fn(() => "drawn-frame")
  const addIframeLayerToGroup = vi.fn(() => "frame-new")
  const addDocumentLayerToGroup = vi.fn(() => "doc-new")
  const hook = renderHook(() => {
    const toolMode = useToolMode()
    const [iframeIds, setIframeIds] = useState(new Set(["frame-old"]))
    const [documentIds, setDocumentIds] = useState(new Set<string>())
    const [groupIds, setGroupIds] = useState(new Set(["g-old"]))
    const draw = useDrawTool({
      documentMode: toolMode.documentMode,
      frameMode: toolMode.frameMode,
      addDocumentLayer: () => "drawn-doc",
      addFrame,
      addIframeLayerToGroup,
      addDocumentLayerToGroup,
      toolMode,
      setSelectedIframeLayerIds: setIframeIds,
      setSelectedDocumentLayerIds: setDocumentIds,
      setSelectedGroupIds: setGroupIds,
      setEditingDocumentLayerId: () => {},
      onFrameDrawn,
    })
    return { toolMode, draw, iframeIds, documentIds, groupIds }
  })
  act(() => hook.result.current.toolMode.set(armed))
  return {
    hook,
    addFrame,
    addIframeLayerToGroup,
    addDocumentLayerToGroup,
    onFrameDrawn,
  }
}

describe("useDrawTool frame release", () => {
  it("asks for the frame it drew, at the drawn rect, back on Select", () => {
    const { hook, addFrame, onFrameDrawn } = setup("frame")
    const { drawTool } = hook.result.current.draw
    act(() => {
      drawTool.beginDraft({ x: 100, y: 200 })
      drawTool.updateDraft({ x: 490, y: 1044 })
      drawTool.commitDraft()
    })

    expect(addFrame).toHaveBeenCalledWith(100, 200, 390, 844)
    expect(onFrameDrawn).toHaveBeenCalledWith("drawn-frame", {
      x: 100,
      y: 200,
      width: 390,
      height: 844,
    })
    expect(hook.result.current.toolMode.mode).toBe("select")
    expect([...hook.result.current.iframeIds]).toEqual(["drawn-frame"])
  })

  it("asks on a click too, at the default size centred on it", () => {
    const { hook, onFrameDrawn } = setup("frame")
    const { drawTool } = hook.result.current.draw
    act(() => {
      drawTool.beginDraft({ x: 0, y: 0 })
      drawTool.commitDraft()
    })

    expect(onFrameDrawn).toHaveBeenCalledTimes(1)
    const rect = onFrameDrawn.mock.calls[0]![1]
    expect(rect.x).toBe(-rect.width / 2)
    expect(rect.y).toBe(-rect.height / 2)
  })

  it("doesn't ask for a Document", () => {
    const { hook, onFrameDrawn } = setup("document")
    const { drawTool } = hook.result.current.draw
    act(() => {
      drawTool.beginDraft({ x: 0, y: 0 })
      drawTool.commitDraft()
    })

    expect(onFrameDrawn).not.toHaveBeenCalled()
  })
})

describe("useDrawTool addAtPlaceholder", () => {
  it("adds a frame to the group, selects it, and drops back to Select", () => {
    const { hook, addIframeLayerToGroup } = setup("frame")
    act(() => hook.result.current.draw.addAtPlaceholder("g1"))

    expect(addIframeLayerToGroup).toHaveBeenCalledWith("g1")
    const { toolMode, iframeIds, documentIds, groupIds } = hook.result.current
    expect(toolMode.mode).toBe("select")
    expect([...iframeIds]).toEqual(["frame-new"])
    expect(documentIds.size).toBe(0)
    expect(groupIds.size).toBe(0)
  })

  it("adds a document to the group, selects it, and drops back to Select", () => {
    const { hook, addDocumentLayerToGroup, addIframeLayerToGroup } =
      setup("document")
    act(() => hook.result.current.draw.addAtPlaceholder("g1"))

    expect(addDocumentLayerToGroup).toHaveBeenCalledWith("g1")
    expect(addIframeLayerToGroup).not.toHaveBeenCalled()
    const { toolMode, iframeIds, documentIds, groupIds } = hook.result.current
    expect(toolMode.mode).toBe("select")
    expect([...documentIds]).toEqual(["doc-new"])
    expect(iframeIds.size).toBe(0)
    expect(groupIds.size).toBe(0)
  })

  it("keeps the tool armed when the add fails", () => {
    const { hook, addIframeLayerToGroup } = setup("frame")
    addIframeLayerToGroup.mockReturnValueOnce(undefined as never)
    act(() => hook.result.current.draw.addAtPlaceholder("missing"))

    expect(hook.result.current.toolMode.mode).toBe("frame")
    expect([...hook.result.current.iframeIds]).toEqual(["frame-old"])
  })
})
