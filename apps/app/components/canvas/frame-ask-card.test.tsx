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

  it("writes it by hand from Write it myself, what was typed as the title", () => {
    const { onClose, onWriteMyself } = renderDocumentCard()

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Launch plan" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Write it myself" }))

    expect(onWriteMyself).toHaveBeenCalledWith("Launch plan")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("writes it by hand on Esc", () => {
    const { onClose, onWriteMyself } = renderDocumentCard()

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" })

    expect(onWriteMyself).toHaveBeenCalledWith("")
    expect(onClose).not.toHaveBeenCalled()
  })

  it("closes on a press outside, leaving the Document", () => {
    const { onClose, onWriteMyself } = renderDocumentCard()

    fireEvent.pointerDown(document.body)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onWriteMyself).not.toHaveBeenCalled()
  })
})
