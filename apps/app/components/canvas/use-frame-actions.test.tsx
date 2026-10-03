// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { BranchData } from "@/lib/types"

const { toast } = vi.hoisted(() => ({
  toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() },
}))
vi.mock("sonner", () => ({ toast }))

import { useFrameActions } from "./use-frame-actions"

/** A Branch carrying exactly the fields `showRoutesForAgent` reads. */
function branch(overrides: Partial<BranchData> = {}): BranchData {
  return { id: "branch-1", status: "running", ...overrides } as BranchData
}

type AddRoutesGroupForAgent = (
  agentId: string,
  routes: { route: string; label: string }[]
) => { groupId: string; firstIframeLayerId: string } | undefined

let camera: {
  zoomToElement: ReturnType<typeof vi.fn>
  zoomToRect: ReturnType<typeof vi.fn>
}
let addRoutesGroupForAgent: ReturnType<typeof vi.fn<AddRoutesGroupForAgent>>
let alertSpy: ReturnType<typeof vi.fn>

function render(agents: BranchData[]) {
  return renderHook(() =>
    useFrameActions({
      camera: camera as never,
      agents,
      iframeLayers: [],
      iframeLayerGroups: [],
      effectiveIframeLayerLayouts: new Map(),
      addIframeLayer: vi.fn(),
      addRoutesGroupForAgent,
      roomId: "room-1",
    })
  )
}

beforeEach(() => {
  camera = { zoomToElement: vi.fn(), zoomToRect: vi.fn() }
  addRoutesGroupForAgent = vi.fn<AddRoutesGroupForAgent>(() => ({
    groupId: "group-1",
    firstIframeLayerId: "layer-1",
  }))
  alertSpy = vi.fn()
  vi.stubGlobal("alert", alertSpy)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("showRoutesForAgent", () => {
  it("toasts instead of alerting when no routes have been discovered", () => {
    const { result } = render([branch({ discoveredRoutes: [] })])

    act(() => result.current.showRoutesForAgent("branch-1"))

    expect(toast.info).toHaveBeenCalledWith(
      "No routes found in this workspace's code yet."
    )
    expect(alertSpy).not.toHaveBeenCalled()
    expect(addRoutesGroupForAgent).not.toHaveBeenCalled()
  })

  it("toasts when the Branch has no discovered-routes field at all", () => {
    const { result } = render([branch()])

    act(() => result.current.showRoutesForAgent("branch-1"))

    expect(toast.info).toHaveBeenCalledTimes(1)
    expect(addRoutesGroupForAgent).not.toHaveBeenCalled()
  })

  it("opens the routes group and zooms to the first frame when routes exist", () => {
    const routes = [{ route: "/", label: "Home" }]
    const { result } = render([branch({ discoveredRoutes: routes })])

    act(() => result.current.showRoutesForAgent("branch-1"))

    expect(addRoutesGroupForAgent).toHaveBeenCalledWith("branch-1", routes)
    expect(toast.info).not.toHaveBeenCalled()
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it("does nothing for an unknown Branch id", () => {
    const { result } = render([branch({ discoveredRoutes: [] })])

    act(() => result.current.showRoutesForAgent("nope"))

    expect(toast.info).not.toHaveBeenCalled()
    expect(addRoutesGroupForAgent).not.toHaveBeenCalled()
  })
})
