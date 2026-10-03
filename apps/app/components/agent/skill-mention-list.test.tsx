// @vitest-environment jsdom
import { act, createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import {
  SKILL_ORIGIN_LABEL,
  SkillMentionList,
  type SkillMentionItem,
  type SkillMentionListHandle,
} from "./skill-mention-list"

/**
 * The `/` menu's rows (#1556): each names where its Skill comes from, and the
 * composer's keys drive the highlight and the pick.
 */

afterEach(cleanup)

// cmdk measures its list and scrolls the selected item into view, which
// jsdom doesn't implement.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}

const ITEMS: SkillMentionItem[] = [
  { name: "brand-voice", description: "Write UI copy.", origin: "canvas" },
  { name: "checkout-e2e", description: "Run the suite.", origin: "repo" },
  { name: "screenplay-add-knob", description: "Add knobs.", origin: "app" },
]

function renderList(items = ITEMS, loading = false) {
  const command = vi.fn()
  const ref = createRef<SkillMentionListHandle>()
  render(
    <SkillMentionList
      ref={ref}
      items={items}
      command={command}
      loading={loading}
    />
  )
  return { command, ref }
}

const key = (k: string) => new KeyboardEvent("keydown", { key: k })
const row = (name: string) =>
  screen.getByText(name).closest("[cmdk-item]") as HTMLElement

describe("SkillMentionList", () => {
  it("ends each row with where its Skill comes from", () => {
    renderList()
    for (const item of ITEMS)
      expect(row(item.name).textContent).toContain(
        SKILL_ORIGIN_LABEL[item.origin]
      )
    expect(row("checkout-e2e").textContent).toContain("Repository")
    expect(row("brand-voice").textContent).toContain("Canvas")
    expect(row("screenplay-add-knob").textContent).toContain("Built in")
  })

  it("moves the highlight with the composer's arrows and picks on Enter", () => {
    const { command, ref } = renderList()
    expect(row("brand-voice").getAttribute("data-selected")).toBe("true")

    act(() => {
      ref.current!.onKeyDown(key("ArrowDown"))
    })
    expect(row("checkout-e2e").getAttribute("data-selected")).toBe("true")

    act(() => {
      ref.current!.onKeyDown(key("ArrowUp"))
      ref.current!.onKeyDown(key("ArrowUp"))
    })
    expect(row("screenplay-add-knob").getAttribute("data-selected")).toBe(
      "true"
    )

    act(() => {
      ref.current!.onKeyDown(key("Enter"))
    })
    expect(command).toHaveBeenCalledWith({
      id: "screenplay-add-knob",
      label: "screenplay-add-knob",
    })
  })

  it("picks a row on click", () => {
    const { command } = renderList()
    fireEvent.click(row("checkout-e2e"))
    expect(command).toHaveBeenCalledWith({
      id: "checkout-e2e",
      label: "checkout-e2e",
    })
  })

  it("says it is loading rather than empty while the index loads", () => {
    renderList([], true)
    expect(screen.getByText("Loading skills…")).toBeTruthy()
    cleanup()
    const { ref } = renderList([], false)
    expect(screen.getByText("No skills found")).toBeTruthy()
    expect(ref.current!.onKeyDown(key("Enter"))).toBe(false)
  })
})
