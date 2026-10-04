// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { AgentMessage } from "@/lib/agent/types"

const offeredSkillState = vi.fn()
const saveOfferedSkill = vi.fn()
vi.mock("@/lib/skills/actions", () => ({
  offeredSkillState: (...args: unknown[]) => offeredSkillState(...args),
  saveOfferedSkill: (...args: unknown[]) => saveOfferedSkill(...args),
}))

import { SkillSaveCard } from "./skill-save-card"

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia

const content =
  "---\nname: design-exploration\ndescription: Explore a design question with lettered takes.\n---\n\nAsk one question."

function call(
  overrides: Partial<AgentMessage & { role: "tool_call" }> = {}
): AgentMessage & { role: "tool_call" } {
  return {
    role: "tool_call",
    toolCallId: "t1",
    title: "save_skill",
    status: "completed",
    content: [],
    rawInput: { name: "design-exploration", content, scope: "account" },
    ...overrides,
  }
}

function renderCard(message = call()) {
  return render(
    <SkillSaveCard
      message={message}
      roomId="room-1"
      fallback={<div data-testid="fallback">row</div>}
    />
  )
}

beforeEach(() => {
  offeredSkillState.mockResolvedValue({
    ok: true,
    savedTo: null,
    replacesBuiltIn: true,
  })
  saveOfferedSkill.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("SkillSaveCard", () => {
  it("shows the skill with the suggested scope first, and saves nothing until pressed", async () => {
    renderCard()
    const account = await screen.findByRole("button", {
      name: "Save to account",
    })
    const canvas = screen.getByRole("button", { name: "Save to canvas" })
    expect(
      account.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByText("design-exploration")).toBeTruthy()
    expect(
      screen.getByText("Explore a design question with lettered takes.")
    ).toBeTruthy()
    expect(screen.getByText("Replaces the Built in skill")).toBeTruthy()
    expect(saveOfferedSkill).not.toHaveBeenCalled()
  })

  it("saves to the pressed scope and says where", async () => {
    renderCard()
    fireEvent.click(
      await screen.findByRole("button", { name: "Save to canvas" })
    )
    expect(await screen.findByText("Saved to this canvas")).toBeTruthy()
    expect(saveOfferedSkill).toHaveBeenCalledWith("room-1", "canvas", {
      name: "design-exploration",
      content,
      files: undefined,
      scope: "account",
    })
    expect(screen.queryByRole("button", { name: "Save to account" })).toBe(null)
  })

  it("reads Saved when the server already holds this skill", async () => {
    offeredSkillState.mockResolvedValue({
      ok: true,
      savedTo: "account",
      replacesBuiltIn: false,
    })
    renderCard()
    expect(await screen.findByText("Saved to your account")).toBeTruthy()
    expect(screen.queryByText("Replaces the Built in skill")).toBe(null)
  })

  it("falls back to the tool row while running and for an invalid skill", async () => {
    renderCard(call({ status: "in_progress" }))
    expect(screen.getByTestId("fallback")).toBeTruthy()
    expect(offeredSkillState).not.toHaveBeenCalled()
    cleanup()

    offeredSkillState.mockResolvedValue({ ok: false, error: "bad" })
    renderCard()
    expect(await screen.findByTestId("fallback")).toBeTruthy()
  })

  it("says so when a save fails, and keeps the buttons", async () => {
    saveOfferedSkill.mockRejectedValue(new Error("nope"))
    vi.spyOn(console, "error").mockImplementation(() => {})
    renderCard()
    fireEvent.click(
      await screen.findByRole("button", { name: "Save to account" })
    )
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Couldn’t save this skill. Try again."
    )
    expect(screen.getByRole("button", { name: "Save to account" })).toBeTruthy()
  })
})
