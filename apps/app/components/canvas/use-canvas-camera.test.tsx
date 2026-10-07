// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import type { ReactNode, RefObject } from "react"
import type { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch"
import { describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness"

import { YjsConnectionProvider } from "@/lib/yjs/context"
import type { CanvasPresence } from "@/lib/yjs/react"
import { useCanvasCamera, type CanvasCameraDeps } from "./use-canvas-camera"

// Following someone onto another page (#1840): the camera asks the canvas to
// show the followed person's page, then lands on their view once it's in.

function fakeTransform() {
  const state = { positionX: 0, positionY: 0, scale: 1 }
  const setTransform = vi.fn((x: number, y: number, scale: number) => {
    state.positionX = x
    state.positionY = y
    state.scale = scale
  })
  const ref = {
    current: { state, setTransform, instance: {} },
  } as unknown as RefObject<ReactZoomPanPinchContentRef | null>
  return { ref, setTransform }
}

const bea = (pageId: string, x: number): CanvasPresence => ({
  identity: { id: "bea", name: "Bea" },
  pointer: null,
  viewport: { x, y: 0, zoom: 1 },
  color: "#f0f",
  selectedIframeLayerIds: [],
  pageId,
})

function setup() {
  const local = new Awareness(new Y.Doc())
  const remote = new Awareness(new Y.Doc())
  const sync = () =>
    applyAwarenessUpdate(
      local,
      encodeAwarenessUpdate(remote, [remote.clientID]),
      "remote"
    )
  const wrapper = ({ children }: { children: ReactNode }) => (
    <YjsConnectionProvider
      value={{ doc: local.doc, awareness: local, roomId: "room" }}
    >
      {children}
    </YjsConnectionProvider>
  )
  const { ref, setTransform } = fakeTransform()
  // The canvas's side: the page on screen, switched by `followPage`.
  let pageId = "page-1"
  const followPage = vi.fn((peerPageId: string | undefined) => {
    const target = peerPageId ?? "page-1"
    if (target === pageId) return false
    pageId = target
    return true
  })
  const deps = (): CanvasCameraDeps => ({
    transformRef: ref,
    canvasWrapperRef: { current: null },
    setPresence: () => {},
    session: null,
    saveViewport: () => {},
    openView: null,
    overlaySelectedIds: new Set(),
    groupSelectedIframeLayerIds: new Set(),
    focusedIframeLayerId: null,
    createFlowIframeLayerId: null,
    editingDocumentLayerId: null,
    spaceHeld: false,
    pageId,
    followPage,
  })
  const hook = renderHook(() => useCanvasCamera(deps()), { wrapper })
  return {
    remote,
    sync,
    hook,
    setTransform,
    followPage,
    page: () => pageId,
    // The canvas re-renders with the page it switched to.
    rerender: () => hook.rerender(),
  }
}

describe("following someone across pages", () => {
  it("switches to their page and lands on their view", () => {
    const { remote, sync, hook, setTransform, followPage, page, rerender } =
      setup()
    remote.setLocalState(bea("page-2", 300))
    act(sync)

    act(() => hook.result.current.follow(remote.clientID))
    expect(followPage).toHaveBeenLastCalledWith("page-2")
    expect(page()).toBe("page-2")
    expect(setTransform).not.toHaveBeenCalled()

    // Once their page is on screen, the camera cuts to where they are.
    rerender()
    expect(setTransform).toHaveBeenLastCalledWith(300, 0, 1, 0)
    expect(hook.result.current.followingConnectionId).toBe(remote.clientID)
  })

  it("keeps following as they change pages", () => {
    const { remote, sync, hook, setTransform, page, rerender } = setup()
    remote.setLocalState(bea("page-1", 100))
    act(sync)
    act(() => hook.result.current.follow(remote.clientID))
    expect(setTransform).toHaveBeenLastCalledWith(100, 0, 1, 200)

    remote.setLocalState(bea("page-3", 500))
    act(sync)
    expect(page()).toBe("page-3")
    rerender()
    expect(setTransform).toHaveBeenLastCalledWith(500, 0, 1, 0)

    // On the same page, their moves glide as before.
    remote.setLocalState(bea("page-3", 600))
    act(sync)
    expect(setTransform).toHaveBeenLastCalledWith(600, 0, 1, 200)
    expect(hook.result.current.followingConnectionId).toBe(remote.clientID)
  })

  it("stops following on a manual camera move", () => {
    const { remote, sync, hook, followPage } = setup()
    remote.setLocalState(bea("page-1", 100))
    act(sync)
    act(() => hook.result.current.follow(remote.clientID))
    act(() => hook.result.current.breakFollow())
    expect(hook.result.current.followingConnectionId).toBeNull()

    followPage.mockClear()
    remote.setLocalState(bea("page-2", 100))
    act(sync)
    expect(followPage).not.toHaveBeenCalled()
  })
})
