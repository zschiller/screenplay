// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness"

import { YjsConnectionProvider } from "./context"
import {
  useOtherPeers,
  usePeerViewport,
  useSelfIdentity,
  type CanvasPresence,
} from "./react"

const presence = (name: string, x = 0): CanvasPresence => ({
  identity: { id: name, name },
  pointer: { x, y: 0 },
  viewport: { x, y: 0, zoom: 1 },
  color: "#f0f",
  selectedIframeLayerIds: [],
})

function setup() {
  const local = new Awareness(new Y.Doc())
  const remote = new Awareness(new Y.Doc())
  const wrapper = ({ children }: { children: ReactNode }) => (
    <YjsConnectionProvider
      value={{ doc: local.doc, awareness: local, roomId: "room" }}
    >
      {children}
    </YjsConnectionProvider>
  )
  const sync = () =>
    applyAwarenessUpdate(
      local,
      encodeAwarenessUpdate(remote, [remote.clientID]),
      "remote"
    )
  return { local, remote, wrapper, sync }
}

describe("presence hooks", () => {
  it("keeps the self identity across our own pointer moves", () => {
    const { local, wrapper } = setup()
    act(() => local.setLocalState(presence("Ada")))
    const { result } = renderHook(() => useSelfIdentity(), { wrapper })
    const first = result.current
    expect(first).toMatchObject({ name: "Ada", message: null })
    act(() => local.setLocalState(presence("Ada", 40)))
    expect(result.current).toBe(first)
    act(() => local.setLocalState({ ...presence("Ada"), message: "hi" }))
    expect(result.current).toMatchObject({ message: "hi" })
  })

  it("keeps the peers across their cursor moves, not their selection", () => {
    const { remote, wrapper, sync } = setup()
    remote.setLocalState(presence("Bea"))
    act(sync)
    const { result } = renderHook(() => useOtherPeers(), { wrapper })
    const first = result.current
    expect(first.map((p) => p.presence.identity.name)).toEqual(["Bea"])
    remote.setLocalState(presence("Bea", 80))
    act(sync)
    expect(result.current).toBe(first)
    remote.setLocalState({ ...presence("Bea"), selectedIframeLayerIds: ["f"] })
    act(sync)
    expect(result.current).not.toBe(first)
  })

  it("follows a peer's viewport and reports them gone", () => {
    const { remote, wrapper, sync } = setup()
    remote.setLocalState(presence("Bea"))
    act(sync)
    const { result, rerender } = renderHook(
      ({ id }: { id: number | null }) => usePeerViewport(id),
      { wrapper, initialProps: { id: null as number | null } }
    )
    expect(result.current).toBeNull()
    rerender({ id: remote.clientID })
    expect(result.current).toEqual({ x: 0, y: 0, zoom: 1 })
    remote.setLocalState(presence("Bea", 80))
    act(sync)
    expect(result.current).toEqual({ x: 80, y: 0, zoom: 1 })
    remote.setLocalState(null)
    act(sync)
    expect(result.current).toBeUndefined()
  })
})
