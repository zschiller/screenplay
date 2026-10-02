// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { NEW_CHAT, NEW_SKETCH_CHAT } from "@/lib/frame-ask"
import type { ChatSessionData } from "@/lib/types"
import { FrameAskCard } from "./frame-ask-card"

// The real composer is an editor; the card only needs a field to type in.
vi.mock("@/components/agent/composer", () => ({
  Composer: ({
    placeholder,
    modelSlot,
  }: {
    placeholder: string
    modelSlot?: React.ReactNode
  }) => (
    <>
      <textarea aria-label={placeholder} />
      {modelSlot}
    </>
  ),
}))

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
