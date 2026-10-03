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
