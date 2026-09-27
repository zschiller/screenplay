// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { targetingStore, type HighlightTarget } from "@/lib/targeting-store"
import { useElementHighlight } from "./use-element-highlight"

// The shared set/clear-by-identity rule behind every element token's canvas
// highlight (#706). A registered handler stands in for the Canvas, so each
// test sees exactly what reached the frame's outline.

describe("useElementHighlight", () => {
  let handler: ReturnType<typeof vi.fn<(t: HighlightTarget | null) => void>>
  let unregister: () => void

  beforeEach(() => {
    handler = vi.fn<(t: HighlightTarget | null) => void>()
    unregister = targetingStore.registerHighlight(handler)
  })

  afterEach(() => {
    cleanup()
    unregister()
  })

  it("highlights on open and clears on close", () => {
    const { result } = renderHook(() =>
      useElementHighlight("t1", "layer-1", "#btn")
    )

    act(() => result.current(true))
    expect(handler).toHaveBeenLastCalledWith({
      iframeLayerId: "layer-1",
      selector: "#btn",
      ref: "t1",
    })

    act(() => result.current(false))
    expect(handler).toHaveBeenLastCalledWith(null)
  })

  it("clears its own highlight on unmount", () => {
    const { result, unmount } = renderHook(() =>
      useElementHighlight("t1", "layer-1", "#btn")
    )
    act(() => result.current(true))

    unmount()
    expect(handler).toHaveBeenLastCalledWith(null)
  })

  it("a stale close never clears a highlight another token set", () => {
    const a = renderHook(() => useElementHighlight("a", "layer-1", "#a"))
    const b = renderHook(() => useElementHighlight("b", "layer-1", "#b"))

    // Enter-before-leave: B opens, then A's close arrives.
    act(() => a.result.current(true))
    act(() => b.result.current(true))
    act(() => a.result.current(false))

    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenLastCalledWith({
      iframeLayerId: "layer-1",
      selector: "#b",
      ref: "b",
    })
  })

  it("unmounting one token never clears another token's highlight", () => {
    const a = renderHook(() => useElementHighlight("a", "layer-1", "#a"))
    const b = renderHook(() => useElementHighlight("b", "layer-1", "#b"))

    act(() => b.result.current(true))
    a.unmount()

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenLastCalledWith({
      iframeLayerId: "layer-1",
      selector: "#b",
      ref: "b",
    })
  })

  it("draws no outline for a token missing its frame or selector", () => {
    const noLayer = renderHook(() => useElementHighlight("a", undefined, "#a"))
    const noSelector = renderHook(() =>
      useElementHighlight("b", "layer-1", undefined)
    )

    act(() => noLayer.result.current(true))
    act(() => noSelector.result.current(true))

    expect(handler).not.toHaveBeenCalled()
  })
})
