// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { FrameStreamConnection } from "@/lib/frame-stream/client"
import type { MockupLayerData } from "@/lib/types"
import { MockupLayer } from "./mockup-layer"

// The page's HTML lives in the Room doc and the runtime comes from the
// server; both are the test's to say.
let html = "<p>Checkout</p>"
vi.mock("@/lib/yjs/react", () => ({ useMockupHtml: () => html }))
vi.mock("@/hooks/use-mockup-refs", () => ({ useMockupRefs: () => ({}) }))
vi.mock("@/hooks/use-mockup-runtime", () => ({
  useMockupRuntime: () => "/* runtime */",
}))
vi.mock("@/hooks/use-screenplay-dom", () => ({
  useScreenplayDom: () => ({ elementAtPoint: vi.fn() }),
}))
vi.mock("@/components/canvas/frame-drive-relay", () => ({
  useDriveFrame: () => {},
}))
// The bar portals into the canvas's toolbar layer.
vi.mock("@/components/canvas/use-layer-toolbar", () => ({
  useLayerToolbar: ({ show }: { show: boolean }) =>
    show ? document.body : null,
}))
// The live page's picture: what it's told to show is what matters here.
const streamView = vi.fn()
vi.mock("@/components/canvas/frame-stream-view", () => ({
  FrameStreamView: (props: { doc?: string; route: string }) => {
    streamView(props)
    return <div data-frame-stream="" />
  },
}))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver

const LAYER: MockupLayerData = {
  id: "mockup-1",
  width: 400,
  height: 300,
  title: "Checkout",
}

const stream = {
  bridgePort: () => ({ post: () => true, subscribe: () => () => {} }),
  frame: () => ({}),
} as unknown as FrameStreamConnection

function renderMockup(props: Partial<Parameters<typeof MockupLayer>[0]> = {}) {
  const noop = () => {}
  const element = (p: typeof props) => (
    <MockupLayer
      layer={LAYER}
      zoom={1}
      selected
      multiSelected={false}
      spaceHeld={false}
      worldX={0}
      worldY={0}
      onSelect={noop}
      onMoveGroup={noop}
      onMoveSelected={noop}
      onResize={noop}
      onRename={noop}
      {...p}
    />
  )
  const view = render(element(props))
  return { ...view, rerender: (p: typeof props) => view.rerender(element(p)) }
}

beforeEach(() => {
  html = "<p>Checkout</p>"
  streamView.mockClear()
})
afterEach(cleanup)

describe("MockupLayer going live (#1523)", () => {
  it("is your own sandboxed copy until someone goes live", () => {
    const onToggleLive = vi.fn()
    renderMockup({ onToggleLive })
    const iframe = document.querySelector("iframe")!
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts")
    expect(iframe.getAttribute("srcdoc")).toContain("<p>Checkout</p>")
    expect(screen.queryByText("Live")).toBeNull()

    const toggle = screen.getByRole("button", { name: "Go live" })
    expect(toggle.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(toggle)
    expect(onToggleLive).toHaveBeenCalledOnce()
  })

  it("shows the live page's stream, with its HTML, and says Live", () => {
    renderMockup({ onToggleLive: () => {}, sharedStream: stream, live: true })
    expect(document.querySelector("iframe")).toBeNull()
    expect(streamView).toHaveBeenLastCalledWith(
      expect.objectContaining({
        route: "/",
        doc: expect.stringContaining("<p>Checkout</p>"),
      })
    )
    expect(screen.getByText("Live")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Live" }).getAttribute("aria-pressed")
    ).toBe("true")
  })

  it("shows the Live tag on the live page", () => {
    renderMockup({ onToggleLive: () => {}, sharedStream: stream, live: true })
    expect(screen.getByText("Live")).toBeTruthy()
  })

  it("sends the live page the new HTML when it changes", () => {
    const props = { onToggleLive: () => {}, sharedStream: stream, live: true }
    const { rerender } = renderMockup(props)
    html = "<p>Paid</p>"
    rerender(props)
    expect(streamView).toHaveBeenLastCalledWith(
      expect.objectContaining({ doc: expect.stringContaining("<p>Paid</p>") })
    )
  })

  it("disables Go live when no Workspace is running", () => {
    const onToggleLive = vi.fn()
    renderMockup({ onToggleLive, liveUnavailable: true })
    const toggle = screen.getByRole("button", { name: "Go live" })
    expect(toggle.hasAttribute("disabled")).toBe(true)
    fireEvent.click(toggle)
    expect(onToggleLive).not.toHaveBeenCalled()
  })

  it("spins while this viewer's going live waits for its first picture", () => {
    renderMockup({ onToggleLive: () => {}, liveStarting: true })
    const toggle = screen.getByRole("button", { name: "Going live" })
    expect(toggle.getAttribute("aria-busy")).toBe("true")
  })

  it("shows no Go live where mockups can't go live", () => {
    renderMockup()
    expect(screen.queryByRole("button", { name: "Go live" })).toBeNull()
  })

  it("adds the Theme knob only while live", () => {
    const onColorSchemeChange = vi.fn()
    const { rerender } = renderMockup({ onColorSchemeChange })
    expect(screen.queryByText("Theme")).toBeNull()
    rerender({ onColorSchemeChange, sharedStream: stream, live: true })
    fireEvent.click(screen.getByRole("button", { name: "Knobs" }))
    expect(screen.getByText("Theme")).toBeTruthy()
  })
})

describe("MockupLayer scroll (#1563)", () => {
  /** A message the page's bridge posts to the canvas. */
  function fromPage(data: unknown) {
    const iframe = document.querySelector("iframe")!
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data, source: iframe.contentWindow })
      )
    })
    return iframe
  }

  it("writes where the page scrolled, for every copy", () => {
    const onScrollChange = vi.fn()
    renderMockup({ onScrollChange })
    fromPage({ type: "screenplay:scroll", scrollX: 0, scrollY: 420 })
    expect(onScrollChange).toHaveBeenCalledWith("mockup-1", 0, 420)
  })

  it("restores the room's scroll when the page loads", () => {
    renderMockup({ layer: { ...LAYER, scrollX: 0, scrollY: 420 } })
    const iframe = document.querySelector("iframe")!
    const post = vi.spyOn(iframe.contentWindow!, "postMessage")
    fromPage({ type: "screenplay:ready" })
    expect(post).toHaveBeenCalledWith(
      { type: "screenplay:scroll-to", scrollX: 0, scrollY: 420 },
      "*"
    )
  })
})

describe("MockupLayer drafts (#1645)", () => {
  function fromPage(data: unknown) {
    const iframe = document.querySelector("iframe")!
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data, source: iframe.contentWindow })
      )
    })
  }
  const draft = { type: "screenplay:draft", text: "Picked B" }

  it("hands the chat a draft from the page this viewer is interacting with", () => {
    const onDraft = vi.fn()
    renderMockup({ onDraft, focused: true })
    fromPage(draft)
    expect(onDraft).toHaveBeenCalledWith("mockup-1", "Picked B")
  })

  it("ignores a draft while this viewer isn't interacting with the page", () => {
    const onDraft = vi.fn()
    renderMockup({ onDraft })
    fromPage(draft)
    expect(onDraft).not.toHaveBeenCalled()
  })

  it("ignores a draft while the agent drives the page", () => {
    const onDraft = vi.fn()
    renderMockup({ onDraft, focused: true, driver: { kind: "agent" } })
    fromPage(draft)
    expect(onDraft).not.toHaveBeenCalled()
  })
})
