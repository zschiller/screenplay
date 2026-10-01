// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { TerminalTabRecord } from "@/lib/terminal-tabs"
import { createMemoryTerminalTabStore } from "@/lib/terminal/tab-store"
import type { BranchData } from "@/lib/types"

import { useTerminalTabs } from "./use-terminal-tabs"

function record(id: string, branch: string): TerminalTabRecord {
  return {
    id,
    userId: "user-1",
    roomId: "room-1",
    branch,
    label: id,
    harnessKey: null,
    createdAt: 1_700_000_000_000,
  }
}

function branch(id: string, sandboxName = `sb-${id}`): BranchData {
  return { id, sandboxName } as BranchData
}

function setup(opts: {
  saved?: TerminalTabRecord[]
  seed?: TerminalTabRecord[]
  agents?: BranchData[]
}) {
  const store = createMemoryTerminalTabStore(opts.saved ?? [])
  const agents = opts.agents ?? [branch("ws-1")]
  const { result } = renderHook(() =>
    useTerminalTabs({
      roomId: "room-1",
      agents,
      initialTerminalTabs: opts.seed ?? opts.saved,
      store,
    })
  )
  return { store, result }
}

const ids = (tabs: { id: string }[]) => tabs.map((t) => t.id)

afterEach(cleanup)

describe("useTerminalTabs", () => {
  it("opens a plain shell and saves its row", () => {
    const { store, result } = setup({})

    let id = ""
    act(() => {
      id = result.current.open("ws-1").id
    })

    expect(ids(result.current.tabs)).toEqual([id])
    expect(result.current.tabs[0]).toMatchObject({
      branchId: "ws-1",
      label: "Shell",
      terminalSessionId: id,
    })
    expect(result.current.tabs[0].harnessKey).toBeUndefined()
    expect(result.current.isTerminal(id)).toBe(true)
    expect(store.rows.get(id)).toMatchObject({
      branch: "ws-1",
      label: "Shell",
      harnessKey: null,
    })
  })

  it("numbers a Workspace's shells", async () => {
    const { result } = setup({
      saved: [record("other", "ws-2")],
      agents: [branch("ws-1"), branch("ws-2")],
    })
    await waitFor(() => expect(ids(result.current.tabs)).toEqual(["other"]))

    act(() => {
      result.current.open("ws-1")
    })
    act(() => {
      result.current.open("ws-1")
    })
    act(() => {
      result.current.open("ws-2")
    })

    expect(result.current.tabs.map((t) => [t.branchId, t.label])).toEqual([
      ["ws-2", "other"],
      ["ws-1", "Shell"],
      ["ws-1", "Shell 2"],
      ["ws-2", "Shell"],
    ])
  })

  it("keeps a restored harness tab's harness, so it reattaches to its CLI", async () => {
    const { result } = setup({
      saved: [{ ...record("claude", "ws-1"), harnessKey: "claude-code" }],
    })

    await waitFor(() => expect(ids(result.current.tabs)).toEqual(["claude"]))
    expect(result.current.tabs[0].harnessKey).toBe("claude-code")
  })

  it("closes a tab: row gone, session killed", async () => {
    const { store, result } = setup({ saved: [record("a", "ws-1")] })

    act(() => {
      result.current.close("a")
    })

    expect(result.current.tabs).toEqual([])
    await waitFor(() => expect(store.rows.has("a")).toBe(false))
    expect(store.killed).toEqual([
      { terminalSessionId: "a", sandboxName: "sb-ws-1" },
    ])
  })

  it("renames a tab", () => {
    const { result } = setup({ saved: [record("a", "ws-1")] })

    act(() => result.current.rename("a", "Server"))

    expect(result.current.tabs[0].label).toBe("Server")
  })

  // #794: a cold room load seeds the saved tabs and then re-fetches them. The
  // Workspace list is already known at that point (the room renders only after
  // its initial sync, which on the local host waits for the disk load), so the
  // prune must leave every saved tab alone.
  it("keeps saved terminal tabs on a cold room load", async () => {
    const saved = [record("claude", "ws-1"), record("shell", "ws-1")]
    const { store, result } = setup({ saved })

    await waitFor(() => expect(ids(result.current.tabs)).toHaveLength(2))
    expect(ids(result.current.tabs)).toEqual(["claude", "shell"])
    expect([...store.rows.keys()]).toEqual(["claude", "shell"])
    expect(store.killed).toEqual([])
  })

  it("restores tabs saved on another device, keeping ones opened here", async () => {
    const { result } = setup({ saved: [record("remote", "ws-1")], seed: [] })

    let local = ""
    act(() => {
      local = result.current.open("ws-1").id
    })

    await waitFor(() =>
      expect(ids(result.current.tabs)).toEqual(["remote", local])
    )
  })

  it("prunes a tab whose Workspace was deleted: row gone, session killed", async () => {
    const { store, result } = setup({
      saved: [record("live", "ws-1"), record("orphan", "ws-gone")],
    })

    await waitFor(() => expect(ids(result.current.tabs)).toEqual(["live"]))
    expect([...store.rows.keys()]).toEqual(["live"])
    // The prune may repeat when the re-fetch brings the tab back before the
    // first delete lands; both calls are idempotent, so only the target
    // matters. The Sandbox went with the Workspace, so there's none to name.
    expect(store.killed.length).toBeGreaterThan(0)
    for (const session of store.killed)
      expect(session).toEqual({
        terminalSessionId: "orphan",
        sandboxName: null,
      })
  })
})
