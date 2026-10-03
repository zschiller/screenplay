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

describe("usePostMessage scroll syncs through the room", () => {
  function mount(scroll: { x: number; y: number } | null) {
    const frameWindow = { postMessage: vi.fn() }
    const iframeRef = {
      current: { contentWindow: frameWindow } as unknown as HTMLIFrameElement,
    }
    const port = iframeBridgePort(iframeRef)
    const onScroll = vi.fn()
    const view = renderHook(
      (props: { x?: number; y?: number }) =>
        usePostMessage({
          port,
          iframeLayerId: "layer-1",
          iframeState: {},
          iframeScrollX: props.x,
          iframeScrollY: props.y,
          onStateChanged: () => {},
          onScroll,
        }),
      { initialProps: scroll ?? {} }
    )
    const fromPage = (data: unknown) => {
      const event = new MessageEvent("message", { data })
      Object.defineProperty(event, "source", { value: frameWindow })
      window.dispatchEvent(event)
    }
    return { frameWindow, onScroll, view, fromPage }
  }

  it("restores the room's scroll when a page (re)loads", () => {
    const { frameWindow, fromPage } = mount({ x: 0, y: 400 })
    frameWindow.postMessage.mockClear()
    fromPage({ type: "screenplay:ready", version: "v" })
    expect(frameWindow.postMessage).toHaveBeenCalledWith(
      { type: "screenplay:scroll-to", scrollX: 0, scrollY: 400 },
      "*"
    )
  })

  it("writes the page's scroll to the room, without echoing it back", () => {
    const { frameWindow, onScroll, view, fromPage } = mount(null)
    fromPage({ type: "screenplay:scroll", scrollX: 0, scrollY: 250 })
    expect(onScroll).toHaveBeenCalledWith("layer-1", 0, 250)

    frameWindow.postMessage.mockClear()
    view.rerender({ x: 0, y: 250 })
    expect(frameWindow.postMessage).not.toHaveBeenCalled()
  })

  it("scrolls the page when someone else scrolls their copy", () => {
    const { frameWindow, view } = mount(null)
    frameWindow.postMessage.mockClear()
    view.rerender({ x: 0, y: 900 })
    expect(frameWindow.postMessage).toHaveBeenCalledWith(
      { type: "screenplay:scroll-to", scrollX: 0, scrollY: 900 },
      "*"
    )
  })
})
