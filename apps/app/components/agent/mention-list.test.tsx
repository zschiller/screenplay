// @vitest-environment jsdom
import { act, createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

import {
  MentionList,
  type MentionItem,
  type MentionListHandle,
} from "./mention-list"
import { buildLayerMentionSuggestion } from "@/lib/layer-mention-suggestion"
import { mentionCandidates } from "@/lib/mention-kinds"

/**
 * The `@` list: documents, then (in a Document) chats and mockups, each kind
 * under its heading; the editor's keys drive the highlight and the pick.
 */

afterEach(cleanup)

const ITEMS: MentionItem[] = [
  { kind: "markdown-layer", id: "d1", label: "Pricing notes" },
  { kind: "chat", id: "b1", label: "Checkout polish" },
  { kind: "chat", id: "s1", label: "Empty cart state" },
  { kind: "mockup-layer", id: "m1", label: "Option A · Illustrated" },
]

describe("MentionList", () => {
  it("groups the items under their kind’s heading, in order", () => {
    render(<MentionList items={ITEMS} command={vi.fn()} />)
    const menu = screen.getByRole("menu")
    expect(menu.textContent).toBe(
      "DocumentsPricing notesChatsCheckout polishEmpty cart stateMockupsOption A · Illustrated"
    )
    expect(screen.getAllByRole("separator")).toHaveLength(2)
  })

  it("leaves out the heading of a kind with nothing to list", () => {
    render(<MentionList items={ITEMS.slice(1, 3)} command={vi.fn()} />)
    expect(screen.queryByText("Documents")).toBeNull()
    expect(screen.queryByRole("separator")).toBeNull()
  })

  it("moves across groups with the arrows and picks with Enter", () => {
    const command = vi.fn()
    const ref = createRef<MentionListHandle>()
    render(<MentionList ref={ref} items={ITEMS} command={command} />)
    act(() => {
      ref.current!.onKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }))
      ref.current!.onKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }))
    })
    expect(
      screen
        .getByRole("menuitem", { name: "Empty cart state" })
        .hasAttribute("data-highlighted")
    ).toBe(true)
    act(() => {
      ref.current!.onKeyDown(new KeyboardEvent("keydown", { key: "Enter" }))
    })
    expect(command).toHaveBeenCalledWith(ITEMS[2])
  })
})

describe("buildLayerMentionSuggestion", () => {
  const itemsFor = (query: string, items: MentionItem[] = ITEMS) =>
    buildLayerMentionSuggestion({ getItems: () => items })!.items!({
      query,
      editor: null as never,
      signal: new AbortController().signal,
    }) as MentionItem[]

  it("lists the candidates in order, all narrowed by the query", () => {
    expect(itemsFor("o").map((i) => i.label)).toEqual([
      "Pricing notes",
      "Checkout polish",
      "Option A · Illustrated",
    ])
  })

  it("keeps up to 12 of each kind, so many documents never hide the rest", () => {
    const docs = mentionCandidates({
      documents: Array.from({ length: 20 }, (_, i) => ({
        id: `d${i}`,
        title: `Doc ${i}`,
      })),
    })
    const items = itemsFor("", [...docs, ...ITEMS.slice(3)])
    expect(items).toHaveLength(13)
    expect(items.at(-1)?.kind).toBe("mockup-layer")
  })
})
