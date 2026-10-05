// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { ChatTarget } from "@/lib/chat/chat-target"

// An empty, loaded chat: the empty state and the Composer are all there is.
vi.mock("@/hooks/use-agent-chat", () => ({
  useAgentChat: () => ({
    messages: [],
    isStreaming: false,
    runStart: null,
    isLoadingHistory: false,
    historyFailed: false,
    failedSend: null,
    queued: [],
    pendingSteers: [],
    steerable: false,
    returnedSteers: [],
    sendMessage: vi.fn(),
    stopMessage: vi.fn(),
    retryFailedSend: vi.fn(),
    takeFailedSend: vi.fn(),
    takeQueued: vi.fn(),
    takeReturnedSteers: vi.fn(),
    retryHistory: vi.fn(),
    retryError: null,
  }),
}))

// The `/` menu only opens on a typed slash, so the skill source the Composer
// asks for is what shows whether a chat has skills.
const useSkillIndex = vi.fn((_source: unknown) => ({
  skills: [],
  loading: false,
}))
vi.mock("@/lib/use-model-catalog", () => ({
  useModelCatalog: () => ({
    status: "ready",
    models: [],
    model: undefined,
    defaultModel: undefined,
    noAgents: false,
    retry: vi.fn(),
  }),
  useSkillIndex: (source: unknown) => useSkillIndex(source),
}))

vi.mock("@/lib/yjs/react", () => ({ useMarkdownLayers: () => [] }))

// jsdom has no ResizeObserver; the chat's scroll pinning only needs one.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
)

import { AgentChat } from "./agent-chat"

afterEach(() => {
  cleanup()
  useSkillIndex.mockClear()
})

function renderChat(target: ChatTarget) {
  render(
    <AgentChat
      chatId={`chat-${target.kind}`}
      roomId="room-1"
      target={target}
      onPlanModeChange={vi.fn()}
    />
  )
}

const skillSource = () => useSkillIndex.mock.calls.at(-1)?.[0]
const placeholder = () =>
  document.querySelector("[data-placeholder]")?.getAttribute("data-placeholder")

describe("AgentChat — affordances per Chat Target", () => {
  it("gives an agent chat skills, plan mode and element picking", () => {
    renderChat({ kind: "agent", branchId: "b1", sandboxName: "sbx-1" })

    // Its Branch for Repo Skills, its canvas for the ones chats saved (#1555).
    expect(skillSource()).toEqual({
      sandboxName: "sbx-1",
      roomId: "room-1",
      chat: undefined,
    })
    expect(screen.getByRole("button", { name: "Plan" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: /target an element/i })
    ).toBeTruthy()
    expect(placeholder()).toBe("Ask the agent… (@ document, / skill)")
    expect(screen.getByText("Change what your frames show")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Add a loading state" })
    ).toBeTruthy()
  })

  it("asks to write to reopen a Done chat (#1705)", () => {
    render(
      <AgentChat
        chatId="chat-agent"
        roomId="room-1"
        target={{ kind: "agent", branchId: "b1", sandboxName: "sbx-1" }}
        onPlanModeChange={vi.fn()}
        done
      />
    )
    expect(placeholder()).toBe("Write to reopen…")
  })

  it("gives the Coordinator’s chat a Plan toggle and a crosshair that picks anywhere", () => {
    renderChat({ kind: "room" })

    // Its `/` menu lists the canvas's and the Coordinator's Skills (#1556).
    expect(skillSource()).toEqual({
      sandboxName: undefined,
      roomId: "room-1",
      chat: "room",
    })
    expect(screen.getByRole("button", { name: "Plan" })).toBeTruthy()
    expect(
      screen.getByRole("button", { name: /target an element/i })
    ).toBeTruthy()
    expect(placeholder()).toBe("Ask the Coordinator… (@ document, / skill)")
    expect(screen.getByText("Ask about this canvas")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "What’s on this canvas?" })
    ).toBeTruthy()
  })
  it("offers Mockup and Document asks on a canvas with no repository", () => {
    render(
      <AgentChat
        chatId="chat-room"
        roomId="room-1"
        target={{ kind: "room" }}
        roomStart={{ kind: "no-repository" }}
        onPlanModeChange={vi.fn()}
      />
    )

    expect(screen.getByText("Sketch or write something")).toBeTruthy()
    expect(screen.getByText(/Ask for a mockup or a document/)).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "Mock up a pricing page" })
    ).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Add repository" })).toBeNull()
    expect(
      screen.queryByRole("button", { name: "What’s on this canvas?" })
    ).toBeNull()
  })
})
