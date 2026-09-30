// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import type { ChatSessionData } from "@/lib/types"

// The Coordinator's body talks to the Room; the panel only decides what it gets.
const coordinatorChat = vi.fn((_props: { chatSession?: ChatSessionData }) => (
  <div data-testid="coordinator-chat" />
))
vi.mock("./coordinator-chat", () => ({
  CoordinatorChat: (props: { chatSession?: ChatSessionData }) =>
    coordinatorChat(props),
}))
vi.mock("./chats-menu", () => ({
  ChatsMenuButton: () => <button type="button">Chats</button>,
}))

import { ChatPanel } from "./chat-panel"

afterEach(() => {
  cleanup()
  coordinatorChat.mockClear()
})

const noop = () => {}

function renderRoomPanel(onCollapse = vi.fn()) {
  const roomChat: ChatSessionData = {
    id: "room-chat-room-1",
    label: "Coordinator",
    createdAt: 1,
  }
  const otherChat: ChatSessionData = {
    id: "chat-2",
    label: "Untitled",
    createdAt: 2,
    branchId: "b1",
  }
  render(
    <ChatPanel
      target={{ kind: "room" }}
      chatSessions={[otherChat, roomChat]}
      selectedChatId={null}
      roomId="room-1"
      onSelectChat={noop}
      onCreateChat={noop}
      onRenameChat={noop}
      onRemoveChat={noop}
      onCloseChat={noop}
      onReopenChat={noop}
      onPlanModeChange={noop}
      onModelChange={noop}
      onCollapse={onCollapse}
      onOpenWorkspace={noop}
    />
  )
  return { roomChat, onCollapse }
}

describe("ChatPanel with the Room target", () => {
  it("shows the Coordinator chat under the shared header", () => {
    const { roomChat } = renderRoomPanel()
    expect(screen.getByRole("heading", { name: "Coordinator" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Chats" })).toBeTruthy()
    expect(screen.getByTestId("coordinator-chat")).toBeTruthy()
    expect(coordinatorChat.mock.calls.at(-1)?.[0].chatSession).toBe(roomChat)
    // One chat per canvas: no tab strip.
    expect(screen.queryByRole("tablist")).toBeNull()
  })

  it("collapses from the header's one Collapse chat button", () => {
    const { onCollapse } = renderRoomPanel()
    const buttons = screen.getAllByRole("button", { name: /Collapse chat/ })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(onCollapse).toHaveBeenCalledOnce()
  })
})
