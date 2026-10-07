// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { NEW_CHAT, NEW_SKETCH_CHAT } from "@/lib/draw-ask"
import type { BranchData, ChatSessionData } from "@/lib/types"
import { baseBranch } from "@/test/canvas/harness"
import { FrameAskCard } from "./frame-ask-card"

// The real composer is an editor; the card only needs a field to type in,
// and its `insertText` to see what the picker carries over.
const { inserted } = vi.hoisted(() => ({ inserted: [] as string[] }))
vi.mock("@/components/agent/composer", async () => {
  const { forwardRef, useImperativeHandle } = await import("react")
  return {
    Composer: forwardRef(function Composer(
      {
        placeholder,
        modelSlot,
        beforeSend,
        onChange,
      }: {
        placeholder: string
        modelSlot?: React.ReactNode
        beforeSend?: React.ReactNode
        onChange?: (payload: { text: string }) => void
      },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        insertText: (text: string) => inserted.push(text),
      }))
      return (
        <>
          <textarea
            aria-label={placeholder}
            onChange={(e) => onChange?.({ text: e.target.value })}
          />
          {modelSlot}
          {beforeSend}
        </>
      )
    }),
  }
})
// Rows need only the Branch's own status.
vi.mock("@/hooks/use-workspace-states", async () => {
  const { roomWorkspaceFacts, workspaceState } =
    await import("@/lib/branch/workspace-state")
  const room = roomWorkspaceFacts([], [])
  return {
    useWorkspaceStates: () => (branch: Parameters<typeof workspaceState>[0]) =>
      workspaceState(branch, room),
  }
})

// cmdk (the preview picker) uses scroll APIs jsdom doesn't implement, plus a
// ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}

beforeEach(() => {
  document.body.innerHTML =
    '<div data-canvas-wrapper><div id="frame-toolbar-portal"></div></div>'
})
afterEach(cleanup)

function renderCard(
  onClose = vi.fn(),
  defaultAnswerer = NEW_CHAT,
  sketchChats: ChatSessionData[] = []
) {
  render(
    <FrameAskCard
      kind="mockup"
      locate={() => ({ left: 0, top: 0, width: 390, height: 844 })}
      markdownLayers={[]}
      workspaces={[]}
      sketchChats={sketchChats}
      defaultAnswerer={defaultAnswerer}
      onSubmit={() => {}}
      onClose={onClose}
    />
  )
  return onClose
}

describe("FrameAskCard for a drawn Mockup box (#1359)", () => {
  it("asks what the mockup should show", () => {
    renderCard()

    expect(
      screen.getByRole("dialog", { name: "What should this mockup show?" })
    ).toBeTruthy()
    expect(screen.getByRole("textbox").getAttribute("aria-label")).toBe(
      "What should this mockup show?"
    )
  })

  it("closes on Esc, so the unsent box goes with it", () => {
    const onClose = renderCard()

    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "Escape",
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("closes on a press outside it, but not inside", () => {
    const onClose = renderCard()

    fireEvent.pointerDown(screen.getByRole("textbox"))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.pointerDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("says a new chat answers on a canvas with no repository and no chats", () => {
    renderCard(vi.fn(), NEW_SKETCH_CHAT)

    expect(screen.getByText("New chat")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Who answers" })).toBeNull()
  })

  it("offers the chats with no repository once there are some", () => {
    renderCard(vi.fn(), { kind: "sketch", chatId: "s-1" }, [
      { id: "s-1", target: "sketch", label: "Pricing sketch", createdAt: 1 },
    ])

    expect(
      screen.getByRole("button", { name: "Who answers" }).textContent
    ).toContain("Pricing sketch")
  })
})

describe("FrameAskCard for a drawn frame with running previews", () => {
  const previews: BranchData[] = [
    baseBranch("b-cart", { title: "Empty cart state" }),
    baseBranch("b-checkout", { title: "Checkout polish" }),
  ]
  function renderFrame(onShow = vi.fn()) {
    inserted.length = 0
    render(
      <FrameAskCard
        locate={() => ({ left: 0, top: 0, width: 390, height: 844 })}
        markdownLayers={[]}
        workspaces={previews}
        defaultAnswerer={NEW_CHAT}
        previews={previews}
        onShow={onShow}
        onSubmit={() => {}}
        onClose={() => {}}
      />
    )
    return onShow
  }
  const search = () => screen.getByPlaceholderText("Search running previews…")

  it("asks which preview to show, the likely one first", () => {
    renderFrame()

    const rows = screen.getAllByRole("option").map((o) => o.textContent)
    expect(rows[0]).toContain("Empty cart state")
    expect(rows[1]).toContain("Checkout polish")
    expect(rows.at(-1)).toBe("New chat…")
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("shows the highlighted preview on Enter", () => {
    const onShow = renderFrame()

    fireEvent.keyDown(search(), { key: "Enter" })

    expect(onShow).toHaveBeenCalledWith("b-cart")
  })

  it("opens the composer from New chat…, with a new chat answering", () => {
    renderFrame()

    fireEvent.click(screen.getByRole("option", { name: "New chat…" }))

    expect(
      screen.getByRole("textbox", { name: "What should this frame show?" })
    ).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Who answers" }).textContent
    ).toContain("New chat")
    expect(inserted).toEqual([])
  })

  it("carries words no preview matches into the new chat’s composer", () => {
    renderFrame()

    fireEvent.change(search(), { target: { value: "A pricing page" } })
    const row = screen.getByRole("option", {
      name: "New chat: “A pricing page”",
    })
    expect(screen.getAllByRole("option")).toHaveLength(1)

    fireEvent.click(row)

    expect(inserted).toEqual(["A pricing page"])
  })
})

describe("FrameAskCard for a drawn Document", () => {
  function renderDocumentCard() {
    const onClose = vi.fn()
    const onWriteMyself = vi.fn()
    render(
      <FrameAskCard
        kind="document"
        locate={() => ({ left: 0, top: 0, width: 480, height: 640 })}
        markdownLayers={[]}
        workspaces={[]}
        defaultAnswerer={NEW_CHAT}
        onSubmit={() => {}}
        onWriteMyself={onWriteMyself}
        onClose={onClose}
      />
    )
    return { onClose, onWriteMyself }
  }

  it("asks what the document should say", () => {
    renderDocumentCard()

    expect(
      screen.getByRole("dialog", { name: "What should this document say?" })
    ).toBeTruthy()
  })

  it("has no Write it myself button: Esc writes it by hand", () => {
    renderDocumentCard()

    expect(screen.queryByRole("button", { name: "Write it myself" })).toBe(null)
  })

  it("writes it by hand on Esc, what was typed as the title", () => {
    const { onClose, onWriteMyself } = renderDocumentCard()

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Launch plan" },
    })
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" })

    expect(onWriteMyself).toHaveBeenCalledWith("Launch plan")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("closes on a press outside, leaving the Document", () => {
    const { onClose, onWriteMyself } = renderDocumentCard()

    fireEvent.pointerDown(document.body)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onWriteMyself).not.toHaveBeenCalled()
  })
})

describe("FrameAskCard opening an existing file (#1890)", () => {
  const files = [
    { id: "m-1", title: "Pricing · Option A" },
    { id: "m-2", title: "Order receipt email" },
  ]

  function renderMockupCard(opts: { files?: typeof files } = {}) {
    inserted.length = 0
    const onOpen = vi.fn()
    const onClose = vi.fn()
    render(
      <FrameAskCard
        kind="mockup"
        locate={() => ({ left: 0, top: 0, width: 480, height: 640 })}
        markdownLayers={[]}
        workspaces={[]}
        defaultAnswerer={NEW_CHAT}
        onSubmit={() => {}}
        files={opts.files ?? files}
        onOpen={onOpen}
        onClose={onClose}
      />
    )
    return { onOpen, onClose }
  }
  const openButton = () => screen.getByRole("button", { name: "Open mockup" })
  const search = () => screen.getByPlaceholderText("Search mockups…")

  it("opens on the prompt, with Open mockup beside Send", () => {
    renderMockupCard()

    expect(
      screen.getByRole("textbox", { name: "What should this mockup show?" })
    ).toBeTruthy()
    expect(openButton()).toBeTruthy()
    expect(screen.queryByPlaceholderText("Search mockups…")).toBe(null)
  })

  it("offers no Open with no file of the kind on the canvas", () => {
    renderMockupCard({ files: [] })

    expect(screen.queryByRole("button", { name: "Open mockup" })).toBe(null)
  })

  it("lists the files, and picking one opens it in the box", () => {
    const { onOpen, onClose } = renderMockupCard()

    fireEvent.click(openButton())
    fireEvent.click(screen.getByRole("option", { name: "Order receipt email" }))

    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Pricing · Option A",
      "Order receipt email",
      "New mockup…",
    ])
    expect(onOpen).toHaveBeenCalledWith("m-2")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("opens the search on ⌘O, starting from what was typed", () => {
    renderMockupCard()

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "pricing" },
    })
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "o", metaKey: true })

    expect(search()).toHaveProperty("value", "pricing")
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Pricing · Option A",
      "New mockup…",
    ])
  })

  it("goes back to the prompt from New mockup…, carrying words no file matched", () => {
    renderMockupCard()
    fireEvent.click(openButton())

    fireEvent.change(search(), { target: { value: "A pricing page" } })
    fireEvent.click(
      screen.getByRole("option", { name: "New mockup: “A pricing page”" })
    )

    expect(
      screen.getByRole("textbox", { name: "What should this mockup show?" })
    ).toBeTruthy()
    expect(inserted).toEqual(["A pricing page"])
  })

  it("goes back to the prompt on Esc, without closing", () => {
    const { onClose } = renderMockupCard()
    fireEvent.click(openButton())

    fireEvent.keyDown(search(), { key: "Escape" })

    expect(
      screen.getByRole("textbox", { name: "What should this mockup show?" })
    ).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})
