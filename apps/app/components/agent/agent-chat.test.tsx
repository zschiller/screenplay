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

    expect(skillSource()).toEqual({ sandboxName: "sbx-1" })
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

  it("gives the Coordinator's chat none of the sandbox affordances", () => {
    renderChat({ kind: "room" })

    expect(skillSource()).toBeUndefined()
    expect(screen.queryByRole("button", { name: "Plan" })).toBeNull()
    expect(
      screen.queryByRole("button", { name: /target an element/i })
    ).toBeNull()
    expect(placeholder()).toBe("Ask the Coordinator… (@ to mention a document)")
    expect(screen.getByText("Ask about this canvas")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "What's on this canvas?" })
    ).toBeTruthy()
  })
  it("offers Mockups, Documents and Add repository on a canvas with no repository", () => {
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
    expect(screen.getByText(/Ask for a Mockup or a Document/)).toBeTruthy()
    expect(screen.getByRole("button", { name: "Add repository" })).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "What's on this canvas?" })
    ).toBeNull()
  })
})
