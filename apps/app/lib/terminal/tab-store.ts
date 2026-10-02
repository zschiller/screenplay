import type { TerminalTabRecord } from "@/lib/terminal-tabs"
import type { TerminalTabData } from "@/lib/types"

/**
 * The Terminal Tab controller's one seam to the outside world (#1265): the
 * persisted row (#258, the `terminalTab` table) and the live session behind a
 * tab. Production binds it to the server actions
 * (`lib/terminal/server-tab-store`); tests use {@link createMemoryTerminalTabStore}.
 *
 * Every method is best-effort from the controller's side: it logs a rejection
 * and moves on, so a down database or sandbox never keeps a tab on screen.
 */
export interface TerminalTabStore {
  /** This User's saved tabs in the room, across every Branch. */
  list: (roomId: string) => Promise<TerminalTabRecord[]>
  /** Save a newly opened tab's row. */
  save: (roomId: string, tab: TerminalTabData) => Promise<void>
  /** Delete a tab's row. Deleting a row that's already gone is a no-op. */
  delete: (roomId: string, id: string) => Promise<void>
  /**
   * End the shell (and whatever runs in it) behind a tab. `sandboxName` is the
   * tab's Branch Sandbox, or `null` when the Branch is gone — the hosted tmux
   * session then died with its Sandbox, but a desktop PTY lives in the sidecar
   * and still has to be killed. A session that's already gone is a no-op.
   */
  killSession: (
    roomId: string,
    session: { terminalSessionId: string; sandboxName: string | null }
  ) => Promise<void>
}

export interface MemoryTerminalTabStore extends TerminalTabStore {
  /** The saved rows, keyed by tab id. */
  rows: Map<string, TerminalTabRecord>
  /** Every session killed, in order. */
  killed: { terminalSessionId: string; sandboxName: string | null }[]
}

/** An in-memory {@link TerminalTabStore} for tests, seeded with `rows`. */
export function createMemoryTerminalTabStore(
  rows: TerminalTabRecord[] = []
): MemoryTerminalTabStore {
  const store: MemoryTerminalTabStore = {
    rows: new Map(rows.map((r) => [r.id, r])),
    killed: [],
    list: async (roomId) =>
      [...store.rows.values()].filter((r) => r.roomId === roomId),
    save: async (roomId, tab) => {
      store.rows.set(tab.id, {
        id: tab.id,
        userId: "memory",
        roomId,
        branch: tab.branchId,
        label: tab.label,
        harnessKey: tab.harnessKey ?? null,
        createdAt: tab.createdAt,
      })
    },
    delete: async (_roomId, id) => {
      store.rows.delete(id)
    },
    killSession: async (_roomId, session) => {
      store.killed.push(session)
    },
  }
  return store
}
