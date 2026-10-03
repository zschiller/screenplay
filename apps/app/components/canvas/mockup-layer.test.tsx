// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { FrameStreamConnection } from "@/lib/frame-stream/client"
import type { MockupLayerData } from "@/lib/types"
import { MockupLayer } from "./mockup-layer"

// The page's HTML lives in the Room doc and the runtime comes from the
// server; both are the test's to say.
let html = "<p>Checkout</p>"
vi.mock("@/lib/yjs/react", () => ({ useMockupHtml: () => html }))
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
      onSetStatus={noop}
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
