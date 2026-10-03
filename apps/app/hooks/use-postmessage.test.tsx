// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { iframeBridgePort } from "@/lib/bridge-port"
import { usePostMessage } from "./use-postmessage"

describe("usePostMessage shared-state request", () => {
  it("answers a loading frame with the room's state, marked initial", () => {
    const frameWindow = { postMessage: vi.fn() }
    const iframeRef = {
      current: { contentWindow: frameWindow } as unknown as HTMLIFrameElement,
    }
    const port = iframeBridgePort(iframeRef)
    renderHook(() =>
      usePostMessage({
        port,
        iframeLayerId: "layer-1",
        iframeState: {},
        sharedState: { billing: "annual" },
        onStateChanged: () => {},
      })
    )
    frameWindow.postMessage.mockClear()

    const event = new MessageEvent("message", {
      data: { type: "screenplay:shared-state-request" },
    })
    Object.defineProperty(event, "source", { value: frameWindow })
    window.dispatchEvent(event)

    expect(frameWindow.postMessage).toHaveBeenCalledWith(
      {
        type: "screenplay:shared-state-apply",
        state: { billing: "annual" },
        initial: true,
      },
      "*"
    )
  })
})

function mountFrame(
  options: Partial<Parameters<typeof usePostMessage>[0]> = {}
) {
  const frameWindow = { postMessage: vi.fn() }
  const iframeRef = {
    current: { contentWindow: frameWindow } as unknown as HTMLIFrameElement,
  }
  const port = iframeBridgePort(iframeRef)
  const onStateChanged = vi.fn()
  const view = renderHook(
    (props: Partial<Parameters<typeof usePostMessage>[0]>) =>
      usePostMessage({
        port,
        iframeLayerId: "layer-1",
        iframeState: {},
        onStateChanged,
        ...props,
      }),
    { initialProps: options }
  )
  const fromPage = (data: unknown) => {
    const event = new MessageEvent("message", { data })
    Object.defineProperty(event, "source", { value: frameWindow })
    window.dispatchEvent(event)
  }
  const sentTypes = () =>
    frameWindow.postMessage.mock.calls.map(
      ([message]) => (message as { type: string }).type
    )
  return { frameWindow, view, fromPage, sentTypes, onStateChanged }
}

describe("usePostMessage scroll is per person (#1518)", () => {
  it("never scrolls a page that just loaded to a position from the room", () => {
    const { fromPage, sentTypes } = mountFrame()
    fromPage({ type: "screenplay:ready", version: "v" })
    expect(sentTypes()).toEqual(["screenplay:init"])
    expect(sentTypes()).not.toContain("screenplay:scroll-to")
  })

  it("writes nothing to the room when the page scrolls", () => {
    const onNavigation = vi.fn()
    const onSharedStateChanged = vi.fn()
    const { fromPage, frameWindow, onStateChanged } = mountFrame({
      onNavigation,
      onSharedStateChanged,
    })
    frameWindow.postMessage.mockClear()
    fromPage({ type: "screenplay:scroll", scrollX: 0, scrollY: 400 })
    expect(onStateChanged).not.toHaveBeenCalled()
    expect(onNavigation).not.toHaveBeenCalled()
    expect(onSharedStateChanged).not.toHaveBeenCalled()
    expect(frameWindow.postMessage).not.toHaveBeenCalled()
  })

  it("still reports the page's route to the room", () => {
    const onNavigation = vi.fn()
    const { fromPage } = mountFrame({ onNavigation })
    fromPage({ type: "screenplay:navigation", path: "/cart" })
    expect(onNavigation).toHaveBeenCalledWith("layer-1", "/cart", false)
  })

  it("still pushes the room's Knobs and shared state to the page", () => {
    const { view, frameWindow } = mountFrame()
    frameWindow.postMessage.mockClear()
    view.rerender({
      knobValues: { dense: true },
      sharedState: { billing: "annual" },
    })
    expect(frameWindow.postMessage).toHaveBeenCalledWith(
      { type: "screenplay:knob-values", values: { dense: true } },
      "*"
    )
    expect(frameWindow.postMessage).toHaveBeenCalledWith(
      {
        type: "screenplay:shared-state-apply",
        state: { billing: "annual" },
        initial: false,
      },
      "*"
    )
  })
})
