// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { SkillMenuItem } from "@/lib/skills-store"
import { WORKSPACE_HOVER_CARD_DELAY_MS } from "@/components/workspace-hover-card"
import { SkillHoverCard, SkillIndexContext } from "./skill-hover-card"

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver

const SKILL = {
  name: "release",
  description: "Cut a release and draft its notes.",
  origin: "repo",
} as SkillMenuItem

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function hover(name: string) {
  vi.useFakeTimers()
  render(
    <SkillIndexContext.Provider value={[SKILL]}>
      <SkillHoverCard name={name}>
        <span>/{name}</span>
      </SkillHoverCard>
    </SkillIndexContext.Provider>
  )
  fireEvent.pointerEnter(screen.getByText(`/${name}`), {
    pointerType: "mouse",
  })
  act(() => vi.advanceTimersByTime(WORKSPACE_HOVER_CARD_DELAY_MS))
}

describe("SkillHoverCard", () => {
  it("shows where the Skill comes from and its description", () => {
    hover("release")
    expect(screen.getByText("Repository skill")).toBeTruthy()
    expect(screen.getByText("Cut a release and draft its notes.")).toBeTruthy()
  })

  it("keeps a Skill the chat doesn't read a bare mention", () => {
    hover("renamed")
    expect(screen.queryByText(/skill$/)).toBeNull()
  })
})
