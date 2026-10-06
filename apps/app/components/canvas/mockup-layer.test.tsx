// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { FrameStreamConnection } from "@/lib/frame-stream/client"
import type { MockupLayerData } from "@/lib/types"
import type { AgentMessage } from "@/lib/agent/types"
import {
  createMockupChatLink,
  type MockupChatLink,
} from "@/lib/canvas/mockup-chat-link"
import { MockupChatLinkProvider } from "./mockup-chat-link"
import { MockupLayer } from "./mockup-layer"

// The page's HTML lives in the Room doc and the runtime comes from the
// server; both are the test's to say.
let html = "<p>Checkout</p>"
vi.mock("@/lib/yjs/react", () => ({ useMockupHtml: () => html }))
vi.mock("@/hooks/use-mockup-refs", () => ({ useMockupRefs: () => ({}) }))
vi.mock("@/hooks/use-mockup-runtime", () => ({
  useMockupRuntime: () => "/* runtime */",
}))
// The page's full size, as its bridge reports it (Fit to content).
const getDocumentSize = vi.fn(async () => ({ width: 402, height: 1800 }))
vi.mock("@/hooks/use-screenplay-dom", () => ({
  useScreenplayDom: () => ({ elementAtPoint: vi.fn(), getDocumentSize }),
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
// The bar's … is a Radix menu, which uses pointer-capture APIs jsdom lacks.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.scrollIntoView = () => {}
}

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

function renderMockup(
  props: Partial<Parameters<typeof MockupLayer>[0]> = {},
  link: MockupChatLink | null = null
) {
  const noop = () => {}
  const element = (p: typeof props) => (
    <MockupChatLinkProvider value={link}>
      <MockupLayer
        layer={LAYER}
        zoom={1}
        selected
        multiSelected={false}
        spaceHeld={false}
        placement={{
          worldX: 0,
          worldY: 0,
          width: LAYER.width,
          height: LAYER.height,
          onMoveGroup: noop,
          onMoveSelected: noop,
        }}
        onSelect={noop}
        onResize={noop}
        onRename={noop}
        {...p}
      />
    </MockupChatLinkProvider>
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

describe("MockupLayer's chat link (#1645, #1644, #1662)", () => {
  function fromPage(data: unknown) {
    const iframe = document.querySelector("iframe")!
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data, source: iframe.contentWindow })
      )
    })
  }
  const draft = { type: "screenplay:draft", text: "Picked B" }
  const ROOM = "room-chat-r1"
  const NO_MESSAGES: AgentMessage[] = []

  /** A canvas whose Sketch Chat made the Mockup, and the Coordinator. */
  function canvasLink(transcripts: Record<string, AgentMessage[]> = {}) {
    const calls = {
      prefill: vi.fn(),
      sendWhenOpen: vi.fn(),
      showRoomChat: vi.fn(),
      showSketchChat: vi.fn(),
    }
    const link = createMockupChatLink({
      mockups: [{ ...LAYER, lastChangedByChatId: "sketch-1" }],
      chats: [
        { id: ROOM, target: "room", createdAt: 0 },
        { id: "sketch-1", target: "sketch", createdAt: 1 },
      ],
      transcripts: {
        messages: (id) => transcripts[id] ?? NO_MESSAGES,
        subscribe: () => () => {},
      },
      panel: {
        shown: () => null,
        showSketchChat: calls.showSketchChat,
        showWorkspaceChat: vi.fn(),
        showRoomChat: calls.showRoomChat,
        openWorkspaceChat: vi.fn(),
        newSketchChat: vi.fn(),
      },
      input: { prefill: calls.prefill, sendWhenOpen: calls.sendWhenOpen },
      draftSource: { set: vi.fn() },
      answered: new Set(),
    })
    return { link, calls }
  }

  it("hands the chat a draft from the page this viewer is interacting with", () => {
    const { link, calls } = canvasLink()
    renderMockup({ focused: true }, link)
    fromPage(draft)
    expect(calls.showSketchChat).toHaveBeenCalledWith("sketch-1")
    expect(calls.prefill).toHaveBeenCalledWith("sketch-1", "Picked B")
  })

  it("ignores a draft while this viewer isn't interacting with the page", () => {
    const { link, calls } = canvasLink()
    renderMockup({}, link)
    fromPage(draft)
    expect(calls.prefill).not.toHaveBeenCalled()
  })

  it("ignores a draft while the agent drives the page", () => {
    const { link, calls } = canvasLink()
    renderMockup({ focused: true, driver: { kind: "agent" } }, link)
    fromPage(draft)
    expect(calls.prefill).not.toHaveBeenCalled()
  })

  it("shows the Coordinator's question on the page, and the tap answers it in the Coordinator", () => {
    const { link, calls } = canvasLink({
      [ROOM]: [
        {
          role: "tool_call",
          toolCallId: "q1",
          title: "ask_question",
          status: "completed",
          content: [],
          rawInput: {
            question: "Which row?",
            options: ["Prices", "Names only"],
            mockup_id: LAYER.id,
          },
        },
      ],
    })
    renderMockup({ focused: true }, link)
    const frame = document.querySelector("iframe")!.contentWindow!
    const posted = vi.spyOn(frame, "postMessage")
    fromPage({ type: "screenplay:question-request" })
    expect(posted).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "screenplay:question-apply",
        question: expect.objectContaining({ id: "q1", question: "Which row?" }),
      }),
      "*"
    )

    fromPage({ type: "screenplay:question-answer", id: "q1", index: 1 })
    expect(calls.showRoomChat).toHaveBeenCalledOnce()
    expect(calls.sendWhenOpen).toHaveBeenCalledWith(ROOM, "Names only")
  })

  describe("on a live page (#1688)", () => {
    const asked: AgentMessage[] = [
      {
        role: "tool_call",
        toolCallId: "q1",
        title: "ask_question",
        status: "completed",
        content: [],
        rawInput: {
          question: "Which row?",
          options: ["Prices", "Names only"],
          mockup_id: LAYER.id,
        },
      },
    ]
    const sam = {
      kind: "person",
      id: "u2",
      name: "Sam",
      color: "#f80",
    } as const

    /** A live page every viewer's canvas hears, over the stream's bridge. */
    function liveStream() {
      const listeners = new Set<(message: unknown) => void>()
      const posted = vi.fn()
      const port = {
        post: (message: unknown) => {
          posted(message)
          return true
        },
        subscribe: (listener: (message: unknown) => void) => {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
      const live = {
        bridgePort: () => port,
        frame: () => ({}),
      } as unknown as FrameStreamConnection
      const fromLivePage = (data: unknown) =>
        act(() => listeners.forEach((listener) => listener(data)))
      return { live, posted, fromLivePage }
    }

    it("answers once from the canvas of the person in control", () => {
      const { link, calls } = canvasLink({ [ROOM]: asked })
      const { live, posted, fromLivePage } = liveStream()
      renderMockup(
        { sharedStream: live, live: true, liveDriver: { kind: "you" } },
        link
      )
      fromLivePage({ type: "screenplay:question-request" })
      expect(posted).toHaveBeenLastCalledWith(
        expect.objectContaining({
          question: expect.objectContaining({ id: "q1", answerable: true }),
        })
      )

      fromLivePage({ type: "screenplay:question-answer", id: "q1", index: 1 })
      fromLivePage({ type: "screenplay:question-answer", id: "q1", index: 1 })
      expect(calls.sendWhenOpen).toHaveBeenCalledOnce()
      expect(calls.sendWhenOpen).toHaveBeenCalledWith(ROOM, "Names only")
    })

    it("leaves the answer to their canvas while someone else has control, still answerable", () => {
      const { link, calls } = canvasLink({ [ROOM]: asked })
      const { live, posted, fromLivePage } = liveStream()
      renderMockup({ sharedStream: live, live: true, liveDriver: sam }, link)
      fromLivePage({ type: "screenplay:question-request" })
      expect(posted).toHaveBeenLastCalledWith(
        expect.objectContaining({
          question: expect.objectContaining({ id: "q1", answerable: true }),
        })
      )

      fromLivePage({ type: "screenplay:question-answer", id: "q1", index: 1 })
      expect(calls.sendWhenOpen).not.toHaveBeenCalled()
      expect(calls.showRoomChat).not.toHaveBeenCalled()
    })

    it("says to answer in the chat while nobody has control", () => {
      const { link, calls } = canvasLink({ [ROOM]: asked })
      const { live, posted, fromLivePage } = liveStream()
      renderMockup({ sharedStream: live, live: true }, link)
      fromLivePage({ type: "screenplay:question-request" })
      expect(posted).toHaveBeenLastCalledWith(
        expect.objectContaining({
          question: expect.objectContaining({ answerable: false }),
        })
      )
      fromLivePage({ type: "screenplay:question-answer", id: "q1", index: 1 })
      expect(calls.sendWhenOpen).not.toHaveBeenCalled()
    })
  })
})

describe("MockupLayer sizes", () => {
  /** Open the bar's … menu and list its items. */
  function openMenu() {
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Mockup options" }),
      {
        button: 0,
        pointerType: "mouse",
      }
    )
    return [
      ...document.querySelectorAll(
        '[role="menuitem"],[role="menuitemcheckbox"]'
      ),
    ].map((item) => item.textContent)
  }

  it("offers a frame's Device size and Fit to content", () => {
    renderMockup({
      onSetSize: () => {},
      onSetFitToContent: () => {},
      onDuplicate: () => {},
      onRemove: () => {},
    })
    expect(openMenu()).toEqual([
      "Rename",
      "Duplicate⌘D",
      "Device size",
      "Fit to content",
      "Delete",
    ])
  })

  it("has no Delete when it can't be removed", () => {
    renderMockup({ onSetSize: () => {} })
    expect(openMenu()).not.toContain("Delete")
  })

  it("sets a device size from the menu", () => {
    const onSetSize = vi.fn()
    renderMockup({ onSetSize })
    openMenu()
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "Device size" }), {
      key: "ArrowRight",
    })
    fireEvent.click(screen.getByRole("menuitem", { name: /iPhone SE/ }))
    expect(onSetSize).toHaveBeenCalledWith("mockup-1", 375, 667)
  })

  it("turns Fit to content on at the page's content height", async () => {
    const onSetFitToContent = vi.fn()
    renderMockup({ onSetFitToContent })
    openMenu()
    const item = screen.getByRole("menuitemcheckbox", {
      name: "Fit to content",
    })
    expect(item.getAttribute("aria-checked")).toBe("false")
    await act(async () => {
      fireEvent.click(item)
    })
    expect(onSetFitToContent).toHaveBeenCalledWith("mockup-1", true, 1800)
  })

  it("turns Fit to content off, keeping the height", async () => {
    const onSetFitToContent = vi.fn()
    renderMockup({
      layer: { ...LAYER, fitHeight: true },
      onSetFitToContent,
    })
    openMenu()
    const item = screen.getByRole("menuitemcheckbox", {
      name: "Fit to content",
    })
    expect(item.getAttribute("aria-checked")).toBe("true")
    await act(async () => {
      fireEvent.click(item)
    })
    expect(onSetFitToContent).toHaveBeenCalledWith("mockup-1", false)
  })

  it("offers Fit to content before there's a page, as a frame does", async () => {
    html = ""
    const onSetFitToContent = vi.fn()
    renderMockup({ onSetSize: () => {}, onSetFitToContent })
    expect(openMenu()).toContain("Fit to content")
    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitemcheckbox", { name: "Fit to content" })
      )
    })
    expect(onSetFitToContent).toHaveBeenCalledWith("mockup-1", true, undefined)
  })
})

describe("MockupLayer's working chat (#1726)", () => {
  it("names the chat working on it with the 9-dot, and drops it when the turn ends", () => {
    const { rerender } = renderMockup({
      workingChat: { chatId: "sketch-1", label: "Receipt ideas" },
    })
    expect(screen.getByText("Receipt ideas")).toBeTruthy()
    expect(screen.getByRole("img", { name: "Working" })).toBeTruthy()

    rerender({ workingChat: undefined })
    expect(screen.queryByText("Receipt ideas")).toBeNull()
    expect(screen.queryByRole("img", { name: "Working" })).toBeNull()
    expect(screen.getByText("Checkout")).toBeTruthy()
  })
})
