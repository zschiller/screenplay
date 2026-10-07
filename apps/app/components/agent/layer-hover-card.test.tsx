// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import type { BranchData } from "@/lib/types"

const BRANCH = {
  id: "b1",
  repoId: "r1",
  ref: "checkout-polish",
  title: "Checkout polish",
  status: "running",
  createdAt: 1,
} as BranchData
const FRAME = {
  id: "f1",
  label: "Checkout",
  branchId: "b1",
  route: "/checkout",
  width: 1280,
  height: 800,
}
const DOCUMENT = {
  id: "d1",
  title: "Launch plan",
  lastChangedByChatId: "c1",
  width: 480,
  height: 640,
}

vi.mock("@/lib/yjs/react", () => ({
  useBranches: () => [BRANCH],
  useChatSessions: () => [{ id: "c1", branchId: "b1", createdAt: 1 }],
  useIframeLayers: () => [FRAME],
  useMarkdownLayers: () => [DOCUMENT],
  useMockupLayers: () => [],
  useLayerFiles: () => [],
  useMockupHtml: () => "",
  useLayerFiles: () => [
    { id: "m-unplaced", kind: "mockup", title: "Cart · B" },
  ],
}))
vi.mock("@/lib/yjs/context", () => ({
  useRoomId: () => "room1",
  useYjs: () => ({ doc: {} }),
}))
vi.mock("@/lib/yjs/fragment-text", () => ({ documentFragment: () => null }))
vi.mock("@/lib/document-markdown", () => ({
  readDocumentBody: () => "Ship the checkout.\n\nThen the receipts.",
}))
vi.mock("@/lib/rooms-actions", () => ({
  getRoomThumbnailManifest: async () => ({
    frames: [{ id: "f1", capture: { url: "https://blob.test/f1.png" } }],
  }),
}))
vi.mock("@/hooks/use-mockup-runtime", () => ({ useMockupRuntime: () => null }))
vi.mock("@/hooks/use-mockup-refs", () => ({ useMockupRefs: () => null }))
const chats = vi.hoisted(() => ({
  value: null as null | {
    onSelectWorkspace: (id: string) => void
    onSelectSketchChat: (id: string) => void
  },
}))
vi.mock("@/components/agent/chats-menu", () => ({
  useChatsMenu: () => chats.value,
}))

import { WORKSPACE_HOVER_CARD_DELAY_MS } from "@/components/workspace-hover-card"
import { LayerHoverCard, type LayerMentionKind } from "./layer-hover-card"

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver

afterEach(() => {
  cleanup()
  chats.value = null
  vi.useRealTimers()
})

function hover(kind: LayerMentionKind, id: string) {
  vi.useFakeTimers()
  render(
    <LayerHoverCard kind={kind} id={id}>
      <button type="button">mention</button>
    </LayerHoverCard>
  )
  fireEvent.pointerEnter(screen.getByText("mention"), { pointerType: "mouse" })
  act(() => vi.advanceTimersByTime(WORKSPACE_HOVER_CARD_DELAY_MS))
  vi.useRealTimers()
}

describe("LayerHoverCard", () => {
  it("stays shut while the pointer only passes over", () => {
    vi.useFakeTimers()
    render(
      <LayerHoverCard kind="frame" id="f1">
        <button type="button">mention</button>
      </LayerHoverCard>
    )
    fireEvent.pointerEnter(screen.getByText("mention"), {
      pointerType: "mouse",
    })
    act(() => vi.advanceTimersByTime(600))
    expect(screen.queryByTestId("layer-hover-card")).toBeNull()
  })

  it("shows a frame's capture, chat, page and size, and opens its chat", async () => {
    const onSelectWorkspace = vi.fn()
    chats.value = { onSelectWorkspace, onSelectSketchChat: vi.fn() }
    hover("frame", "f1")
    const card = screen.getByTestId("layer-hover-card")
    expect(card.textContent).toContain("Checkout")
    expect(card.textContent).toContain("Frame")
    expect(card.textContent).toContain("Checkout polish")
    expect(card.textContent).toContain("/checkout")
    expect(card.textContent).toContain("1280 × 800")
    await waitFor(() =>
      expect(card.querySelector("img")?.getAttribute("src")).toBe(
        "https://blob.test/f1.png"
      )
    )
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }))
    expect(onSelectWorkspace).toHaveBeenCalledWith("b1")
    expect(screen.queryByTestId("layer-hover-card")).toBeNull()
  })

  it("shows a document's opening lines, who edited it and its length", () => {
    hover("document", "d1")
    const card = screen.getByTestId("layer-hover-card")
    expect(card.textContent).toContain("Ship the checkout.")
    expect(card.textContent).toContain("Edited by")
    expect(card.textContent).toContain("2 lines")
    // No chats menu (the player): no Open chat.
    expect(screen.queryByRole("button", { name: "Open chat" })).toBeNull()
  })

  it("shows a file with no view on the canvas, without a size (#1884)", () => {
    hover("mockup", "m-unplaced")
    const card = screen.getByTestId("layer-hover-card")
    expect(card.textContent).toContain("Cart · B")
    expect(card.textContent).not.toContain("Size")
    expect(card.textContent).not.toContain("deleted")
  })

  it("says so when the layer is gone", () => {
    hover("mockup", "gone")
    expect(screen.getByTestId("layer-hover-card").textContent).toBe(
      "This mockup was deleted."
    )
  })
})
