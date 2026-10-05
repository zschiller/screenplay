// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { AgentMessage } from "@/lib/agent/types"
import { inputStore } from "@/lib/input-store"

const offeredMergeState = vi.fn()
const mergeOfferedPr = vi.fn()
vi.mock("@/lib/github-merge-actions", () => ({
  offeredMergeState: (...args: unknown[]) => offeredMergeState(...args),
  mergeOfferedPr: (...args: unknown[]) => mergeOfferedPr(...args),
}))

import { MergePrCard } from "./merge-pr-card"

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver

function call(
  overrides: Partial<AgentMessage & { role: "tool_call" }> = {}
): AgentMessage & { role: "tool_call" } {
  return {
    role: "tool_call",
    toolCallId: "t1",
    title: "mcp__screenplay__merge_pr",
    status: "completed",
    rawInput: { number: 7 },
    content: [
      {
        type: "content",
        content: {
          type: "text",
          text: "Showed a merge card for acme/web#7 (Fix sign-in). Nothing merges until someone presses Merge on it; Not now comes back as their next message.",
        },
      },
    ],
    ...overrides,
  }
}

const pr = {
  ok: true,
  title: "Fix sign-in",
  url: "https://github.com/acme/web/pull/7",
  state: "open",
  draft: false,
  mergeableState: "clean",
  checks: "passing",
  sha: "abc123",
  methods: ["squash", "merge"],
}

function renderCard(message = call()) {
  return render(
    <MergePrCard
      message={message}
      roomId="room-1"
      chatId="chat-1"
      fallback={<div data-testid="fallback">row</div>}
    />
  )
}

const action = async (name: string) =>
  (await screen.findByRole("button", { name })) as HTMLButtonElement

beforeEach(() => {
  offeredMergeState.mockResolvedValue(pr)
  mergeOfferedPr.mockResolvedValue({ ok: true, sha: "def456" })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("MergePrCard", () => {
  it("asks to merge, and merges nothing until pressed", async () => {
    renderCard()
    const merge = await action("Squash and merge")
    expect(screen.getByText("#7 Fix sign-in")).toBeTruthy()
    expect(screen.getByText("All checks have passed")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy()
    expect(offeredMergeState).toHaveBeenCalledWith("room-1", {
      repo: "acme/web",
      number: 7,
      method: undefined,
    })
    expect(mergeOfferedPr).not.toHaveBeenCalled()

    fireEvent.click(merge)
    expect((await screen.findByTestId("card-outcome")).textContent).toBe(
      "Merged #7 Fix sign-in"
    )
    expect(mergeOfferedPr).toHaveBeenCalledWith("room-1", {
      repo: "acme/web",
      number: 7,
      method: "squash",
      sha: "abc123",
    })
    expect(screen.queryByRole("button", { name: "Not now" })).toBe(null)
  })

  it("uses the method the agent asked for when the repository allows it", async () => {
    renderCard(call({ rawInput: { number: 7, method: "merge" } }))
    expect(await action("Merge")).toBeTruthy()
    expect(screen.queryByRole("button", { name: /Squash/ })).toBeNull()
  })

  it("can’t merge a conflicted PR, and says why", async () => {
    offeredMergeState.mockResolvedValue({ ...pr, mergeableState: "dirty" })
    renderCard()
    const merge = await action("Squash and merge")
    expect(screen.getByText("Has conflicts with its base")).toBeTruthy()
    expect(merge.disabled).toBe(true)
  })

  it("answers the agent with Not now, and merges nothing", async () => {
    const send = vi.spyOn(inputStore, "send").mockResolvedValue(true)
    renderCard()
    fireEvent.click(await action("Not now"))
    expect(send).toHaveBeenCalledWith("chat-1", "Not now")
    expect((await screen.findByTestId("card-outcome")).textContent).toBe(
      "Didn’t merge #7 Fix sign-in"
    )
    expect(mergeOfferedPr).not.toHaveBeenCalled()
    send.mockRestore()
  })

  it("shows GitHub’s refusal", async () => {
    mergeOfferedPr.mockResolvedValue({
      ok: false,
      error: "Head branch was modified (409)",
    })
    renderCard()
    fireEvent.click(await action("Squash and merge"))
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Head branch was modified (409)"
    )
  })

  it("shows the plain row while the call runs and when it declined", () => {
    renderCard(call({ status: "in_progress", content: [] }))
    expect(screen.getByTestId("fallback")).toBeTruthy()
    cleanup()
    renderCard(
      call({
        content: [
          {
            type: "content",
            content: { type: "text", text: "#7 is already merged." },
          },
        ],
      })
    )
    expect(screen.getByTestId("fallback")).toBeTruthy()
    expect(offeredMergeState).not.toHaveBeenCalled()
  })
})
