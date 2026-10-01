import { describe, expect, it } from "vitest"

import {
  DEFAULT_TERMINAL_PANE_PREF,
  DEV_SERVER_TERMINAL_ID,
  isTerminalPaneToggle,
  paneCloseFallback,
  paneTerminals,
  parseTerminalPanePref,
  resolvePaneSelection,
} from "@/lib/chat/terminal-pane"
import type { TerminalTabData } from "@/lib/types"

function shell(
  id: string,
  createdAt: number,
  branchId = "ws-1",
  label = id
): TerminalTabData {
  return { id, branchId, terminalSessionId: id, label, createdAt }
}

describe("paneTerminals", () => {
  it("lists Dev server first, then the Workspace's shells oldest first", () => {
    const terminals = paneTerminals(
      [shell("s2", 2), shell("other", 0, "ws-2"), shell("s1", 1)],
      "ws-1"
    )
    expect(terminals.map((t) => [t.kind, t.id])).toEqual([
      ["dev-server", DEV_SERVER_TERMINAL_ID],
      ["shell", "s1"],
      ["shell", "s2"],
    ])
    expect(terminals[0]!.label).toBe("Dev server")
  })

  it("is just Dev server when there are no shells", () => {
    expect(paneTerminals([], "ws-1").map((t) => t.id)).toEqual([
      DEV_SERVER_TERMINAL_ID,
    ])
  })
})

describe("resolvePaneSelection", () => {
  const terminals = paneTerminals([shell("s1", 1)], "ws-1")

  it("keeps a selected terminal that's still there", () => {
    expect(resolvePaneSelection(terminals, "s1")).toBe("s1")
  })

  it("lands on Dev server when nothing is picked or the shell is gone", () => {
    expect(resolvePaneSelection(terminals, null)).toBe(DEV_SERVER_TERMINAL_ID)
    expect(resolvePaneSelection(terminals, "gone")).toBe(DEV_SERVER_TERMINAL_ID)
  })
})

describe("paneCloseFallback", () => {
  const terminals = paneTerminals(
    [shell("s1", 1), shell("s2", 2), shell("s3", 3)],
    "ws-1"
  )

  it("moves to the next tab", () => {
    expect(paneCloseFallback(terminals, "s2")).toBe("s3")
  })

  it("moves to the previous tab when closing the last one", () => {
    expect(paneCloseFallback(terminals, "s3")).toBe("s2")
  })

  it("falls back to Dev server when the only shell closes", () => {
    const one = paneTerminals([shell("s1", 1)], "ws-1")
    expect(paneCloseFallback(one, "s1")).toBe(DEV_SERVER_TERMINAL_ID)
  })

  it("keeps Dev server, which never closes", () => {
    expect(paneCloseFallback(terminals, DEV_SERVER_TERMINAL_ID)).toBe(
      DEV_SERVER_TERMINAL_ID
    )
  })
})

describe("parseTerminalPanePref", () => {
  it("reads a stored pref", () => {
    expect(parseTerminalPanePref('{"open":true,"size":55}')).toEqual({
      open: true,
      size: 55,
    })
  })

  it("starts closed at the default height", () => {
    expect(parseTerminalPanePref(null)).toEqual(DEFAULT_TERMINAL_PANE_PREF)
    expect(DEFAULT_TERMINAL_PANE_PREF.open).toBe(false)
  })

  it("falls back field by field on anything malformed", () => {
    expect(parseTerminalPanePref("not json")).toEqual(
      DEFAULT_TERMINAL_PANE_PREF
    )
    expect(parseTerminalPanePref('{"open":"yes","size":2}')).toEqual(
      DEFAULT_TERMINAL_PANE_PREF
    )
    expect(parseTerminalPanePref('{"open":true,"size":300}')).toEqual({
      open: true,
      size: DEFAULT_TERMINAL_PANE_PREF.size,
    })
  })
})

describe("isTerminalPaneToggle", () => {
  const key = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }

  it("is ⌃`", () => {
    expect(
      isTerminalPaneToggle({ ...key, ctrlKey: true, code: "Backquote" })
    ).toBe(true)
  })

  it("ignores the key without Control, or with other modifiers", () => {
    expect(isTerminalPaneToggle({ ...key, code: "Backquote" })).toBe(false)
    expect(
      isTerminalPaneToggle({
        ...key,
        ctrlKey: true,
        metaKey: true,
        code: "Backquote",
      })
    ).toBe(false)
    expect(isTerminalPaneToggle({ ...key, ctrlKey: true, code: "KeyK" })).toBe(
      false
    )
  })
})
