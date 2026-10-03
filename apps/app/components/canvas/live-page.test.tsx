// @vitest-environment jsdom
import { useRef } from "react"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@workspace/ui/components/tooltip"
import type { BridgePort } from "@/lib/bridge-port"
import type { FrameStreamConnection } from "@/lib/frame-stream/client"
import type { IframeToCanvasMessage } from "@/lib/postmessage-protocol"
import type { LayerShellApi } from "./layer-shell"
import {
  LivePageContent,
  LivePageControls,
  LivePageOverlay,
  livePageChrome,
  useLivePage,
  type LivePageSource,
  type LivePageWrites,
} from "./live-page"
import type { FrameDriverView } from "./use-frame-control"

// The page's DOM bridge answers hit-tests; what the page would answer is the
// test's to say.
const elementAtPoint = vi.fn()
vi.mock("@/hooks/use-screenplay-dom", () => ({
  useScreenplayDom: () => dom,
}))
const dom = {
  elementAtPoint: (x: number, y: number) => elementAtPoint(x, y),
  drive: vi.fn(),
  stopDrive: vi.fn(),
  pageSnapshot: vi.fn(),
}

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver

afterEach(cleanup)
beforeEach(() => elementAtPoint.mockReset())

const API: LayerShellApi = {
  bodyDragHandlers: undefined,
  onBodyPointerDownCapture: () => {},
  deferSelect: () => {},
}

const KNOB = {
  type: "tabs",
  id: "size",
  label: "Size",
  default: "m",
  options: [
    { value: "s", label: "S" },
    { value: "m", label: "M" },
  ],
}

function writes() {
  return {
    knobsDeclared: vi.fn<LivePageWrites["knobsDeclared"]>(),
    knobValues: vi.fn<LivePageWrites["knobValues"]>(),
    sharedState: vi.fn<LivePageWrites["sharedState"]>(),
  }
}

interface HarnessProps {
  source: LivePageSource
  writes?: LivePageWrites
  focused?: boolean
  driver?: FrameDriverView
  commentMode?: boolean
  pickActive?: boolean
  dimmed?: boolean
  spaceHeld?: boolean
  zoom?: number
  onHover?: (id: string, rect: unknown) => void
  onSelect?: (id: string, shiftKey: boolean) => void
  onFocus?: (id: string | null) => void
}

/** A layer as small as can be: the page, its overlay and its bar. */
function Harness({
  source,
  writes,
  focused = false,
  driver = { kind: "none" },
  commentMode,
  pickActive,
  dimmed,
  spaceHeld = false,
  zoom = 1,
  onHover,
  onSelect = () => {},
  onFocus,
}: HarnessProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const page = useLivePage({
    id: "page-1",
    source,
    record: { knobs: [KNOB], knobValues: { size: "m" } },
    writes,
    interactive: focused,
    driver,
    zoom,
    width: 400,
    height: 300,
    iframeRef,
    bodyRef,
  })
  return (
    <TooltipProvider>
      <div ref={bodyRef} data-testid="body">
        <LivePageContent page={page} iframeRef={iframeRef} />
        <LivePageOverlay
          page={page}
          api={API}
          hasPage
          commentMode={commentMode}
          pickActive={pickActive}
          dimmed={dimmed}
          spaceHeld={spaceHeld}
          onHover={onHover}
          onSelect={onSelect}
          onFocus={onFocus}
        />
      </div>
      <LivePageControls page={page} focused={focused} onFocus={onFocus} />
    </TooltipProvider>
  )
}

const SOURCES: Record<"frame" | "mockup", LivePageSource> = {
  frame: { kind: "url", src: "https://preview.test/" },
  mockup: { kind: "srcdoc", srcDoc: "<p>Hi</p>", title: "Pricing" },
}

const overlay = () =>
  document.querySelector<HTMLElement>("[data-live-page-overlay]")

/** Post a message from the page, as its bridge would. */
function postFromPage(message: IframeToCanvasMessage) {
  const iframe = document.querySelector("iframe")!
  const event = new MessageEvent("message", { data: message })
  Object.defineProperty(event, "source", { value: iframe.contentWindow })
  act(() => {
    window.dispatchEvent(event)
  })
}

describe.each(["frame", "mockup"] as const)("a %s's live page", (kind) => {
  const source = SOURCES[kind]

  it("renders the page in a sandboxed iframe", () => {
    render(<Harness source={source} />)
    const iframe = document.querySelector("iframe")!
    expect(iframe.getAttribute("sandbox")).toBe(
      kind === "frame"
        ? "allow-scripts allow-same-origin allow-forms allow-popups"
        : "allow-scripts"
    )
    // Outside Interact the overlay takes the pointer.
    expect(iframe.style.pointerEvents).toBe("none")
  })

  describe("Interact", () => {
    it("enters on a double-click, narrowing the selection first", () => {
      const onSelect = vi.fn()
      const onFocus = vi.fn()
      render(<Harness source={source} onSelect={onSelect} onFocus={onFocus} />)
      fireEvent.doubleClick(overlay()!)
      expect(onSelect).toHaveBeenCalledWith("page-1", false)
      expect(onFocus).toHaveBeenCalledWith("page-1")
    })

    it("leaves the double-click to a comment or a pick", () => {
      const onFocus = vi.fn()
      const { rerender } = render(
        <Harness source={source} commentMode onFocus={onFocus} />
      )
      fireEvent.doubleClick(overlay()!)
      rerender(<Harness source={source} dimmed onFocus={onFocus} />)
      fireEvent.doubleClick(overlay()!)
      expect(onFocus).not.toHaveBeenCalled()
    })

    it("toggles from the bar's Interact button", () => {
      const onFocus = vi.fn()
      const { rerender } = render(<Harness source={source} onFocus={onFocus} />)
      fireEvent.click(screen.getByRole("button", { name: "Interact" }))
      expect(onFocus).toHaveBeenLastCalledWith("page-1")
      rerender(
        <Harness
          source={source}
          focused
          driver={{ kind: "you" }}
          onFocus={onFocus}
        />
      )
      fireEvent.click(screen.getByRole("button", { name: "Interact" }))
      expect(onFocus).toHaveBeenLastCalledWith(null)
    })

    it("hands the page the pointer while interacting", () => {
      render(<Harness source={source} focused driver={{ kind: "you" }} />)
      expect(overlay()).toBeNull()
      expect(document.querySelector("iframe")!.style.pointerEvents).toBe("auto")
    })
  })

  describe("Knobs and shared state", () => {
    it("writes the knobs the page declares to its record", () => {
      const w = writes()
      render(<Harness source={source} writes={w} />)
      postFromPage({ type: "screenplay:knobs-declared", knobs: [KNOB] })
      expect(w.knobsDeclared).toHaveBeenCalledWith("page-1", [KNOB])
    })

    it("writes a knob set from the bar's Knobs", async () => {
      const w = writes()
      render(<Harness source={source} writes={w} />)
      fireEvent.click(screen.getByRole("button", { name: "Knobs" }))
      fireEvent.mouseDown(await screen.findByRole("tab", { name: "S" }))
      expect(w.knobValues).toHaveBeenCalledWith("page-1", { size: "s" })
    })

    it("writes the state the page shares", () => {
      const w = writes()
      render(<Harness source={source} writes={w} />)
      postFromPage({
        type: "screenplay:shared-state",
        state: { plan: "annual" },
      })
      expect(w.sharedState).toHaveBeenCalledWith("page-1", { plan: "annual" })
    })
  })

  describe("targeting", () => {
    function renderAt(props: Partial<HarnessProps>) {
      const onHover = vi.fn()
      render(
        <Harness source={source} zoom={0.5} onHover={onHover} {...props} />
      )
      const body = screen.getByTestId("body")
      body.getBoundingClientRect = () =>
        ({ left: 100, top: 50, width: 200, height: 150 }) as DOMRect
      return onHover
    }

    it.each([
      ["a comment", { commentMode: true }],
      ["a pick", { pickActive: true }],
    ])("outlines the element %s would target", async (_, props) => {
      const rect = { x: 10, y: 20, width: 30, height: 40 }
      elementAtPoint.mockResolvedValue({ rect, selector: "p" })
      const onHover = renderAt(props)
      fireEvent.pointerMove(overlay()!, { clientX: 150, clientY: 70 })
      // The screen point maps into the page's own, unzoomed viewport.
      await waitFor(() => expect(onHover).toHaveBeenCalledWith("page-1", rect))
      expect(elementAtPoint).toHaveBeenCalledWith(100, 40)
      fireEvent.pointerLeave(overlay()!)
      expect(onHover).toHaveBeenLastCalledWith("page-1", null)
    })

    it("clears the outline outside the page", async () => {
      const onHover = renderAt({ pickActive: true })
      fireEvent.pointerMove(overlay()!, { clientX: 400, clientY: 70 })
      await waitFor(() => expect(onHover).toHaveBeenCalledWith("page-1", null))
      expect(elementAtPoint).not.toHaveBeenCalled()
    })

    it("doesn't track a page the pick can't hit, and washes it", () => {
      const onHover = renderAt({ pickActive: true, dimmed: true })
      fireEvent.pointerMove(overlay()!, { clientX: 150, clientY: 70 })
      expect(onHover).not.toHaveBeenCalled()
      expect(document.querySelector(".bg-background\\/60")).toBeTruthy()
    })

    it("doesn't track while space pans the canvas", () => {
      const onHover = renderAt({ commentMode: true, spaceHeld: true })
      fireEvent.pointerMove(overlay()!, { clientX: 150, clientY: 70 })
      expect(onHover).not.toHaveBeenCalled()
    })
  })
})

describe("a live frame's page", () => {
  function fakeStream() {
    let listener: ((message: IframeToCanvasMessage) => void) | null = null
    const port: BridgePort = {
      post: () => true,
      subscribe: (l) => {
        listener = l
        return () => {
          listener = null
        }
      },
    }
    const stream = {
      bridgePort: vi.fn(() => port),
      frame: vi.fn(),
    } as unknown as FrameStreamConnection
    return { stream, send: (m: IframeToCanvasMessage) => listener?.(m) }
  }

  it("speaks to the shared browser over its stream", () => {
    const { stream, send } = fakeStream()
    const w = writes()
    render(
      <Harness
        source={{
          kind: "stream",
          stream,
          // Nothing to show yet, so no picture mounts.
          hasPage: false,
          route: "/",
          scheme: "light",
          onRoute: () => {},
          onLive: () => {},
        }}
        writes={w}
      />
    )
    expect(stream.bridgePort).toHaveBeenCalledWith("page-1")
    expect(document.querySelector("iframe")).toBeNull()
    act(() => send({ type: "screenplay:knobs-declared", knobs: [KNOB] }))
    expect(w.knobsDeclared).toHaveBeenCalledWith("page-1", [KNOB])
  })
})

describe("livePageChrome", () => {
  const person: FrameDriverView = {
    kind: "person",
    name: "Ada",
    color: "#f0f",
  } as FrameDriverView

  it("tags and locks a page someone else drives", () => {
    const chrome = livePageChrome({ driver: person, focused: false })
    expect(chrome.resizable).toBe(false)
    render(<>{chrome.titleTag}</>)
    expect(screen.getByText("Ada has control")).toBeTruthy()
  })

  it("says Live, and answers to the live copy's driver from an own copy", () => {
    const idle = livePageChrome({
      driver: { kind: "none" },
      focused: false,
      live: true,
      liveDriver: { kind: "none" },
    })
    expect(idle.resizable).toBe(true)
    render(<>{idle.titleTag}</>)
    expect(screen.getByText("Live")).toBeTruthy()
    cleanup()

    const driven = livePageChrome({
      driver: { kind: "none" },
      focused: false,
      live: true,
      liveDriver: person,
    })
    expect(driven.resizable).toBe(false)
    render(<>{driven.titleTag}</>)
    expect(screen.getByText("Ada has control")).toBeTruthy()
  })

  it("never resizes a page you're interacting with", () => {
    expect(
      livePageChrome({ driver: { kind: "you" }, focused: true }).resizable
    ).toBe(false)
  })
})
