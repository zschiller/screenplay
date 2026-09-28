// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { TerminalTabRecord } from "@/lib/terminal-tabs"
import type { BranchData } from "@/lib/types"

const { listTerminalTabsAction, deleteTerminalTabAction } = vi.hoisted(() => ({
  listTerminalTabsAction: vi.fn(),
  deleteTerminalTabAction: vi.fn(),
}))

vi.mock("@/lib/terminal-tabs-actions", () => ({
  listTerminalTabsAction,
  deleteTerminalTabAction,
}))

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

function branch(id: string): BranchData {
  return { id } as BranchData
}

beforeEach(() => {
  deleteTerminalTabAction.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe("useTerminalTabs", () => {
  // #794: a cold room load seeds the saved tabs and then re-fetches them. The
  // Workspace list is already known at that point (the room renders only after
  // its initial sync, which on the local host waits for the disk load), so the
  // prune must leave every saved tab alone.
  it("keeps saved terminal tabs on a cold room load", async () => {
    const saved = [record("claude", "ws-1"), record("shell", "ws-1")]
    listTerminalTabsAction.mockResolvedValue(saved)

    const { result } = renderHook(() =>
      useTerminalTabs({
        roomId: "room-1",
        agents: [branch("ws-1")],
        initialTerminalTabs: saved,
      })
    )

    await waitFor(() =>
      expect(listTerminalTabsAction).toHaveBeenCalledWith({ roomId: "room-1" })
    )
    expect(result.current.localTerminals.map((t) => t.id)).toEqual([
      "claude",
      "shell",
    ])
    expect(deleteTerminalTabAction).not.toHaveBeenCalled()
  })

  it("prunes a saved tab whose Workspace was deleted", async () => {
    const saved = [record("live", "ws-1"), record("orphan", "ws-gone")]
    listTerminalTabsAction.mockResolvedValue(saved)

    const { result } = renderHook(() =>
      useTerminalTabs({
        roomId: "room-1",
        agents: [branch("ws-1")],
        initialTerminalTabs: saved,
      })
    )

    await waitFor(() =>
      expect(result.current.localTerminals.map((t) => t.id)).toEqual(["live"])
    )
    // The delete may repeat when the re-fetch brings the row back before the
    // first delete lands; it's idempotent, so only the target matters.
    for (const [args] of deleteTerminalTabAction.mock.calls)
      expect(args).toEqual({ roomId: "room-1", id: "orphan" })
    expect(deleteTerminalTabAction).toHaveBeenCalled()
  })
})
