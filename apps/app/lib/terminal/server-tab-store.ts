import {
  createTerminalTabAction,
  deleteTerminalTabAction,
  killOrphanedTerminalSessionAction,
  killTerminalSessionAction,
  listTerminalTabsAction,
} from "@/lib/terminal-tabs-actions"
import type { TerminalTabStore } from "@/lib/terminal/tab-store"

/** The production {@link TerminalTabStore}: the Terminal Tab server actions. */
export const serverTerminalTabStore: TerminalTabStore = {
  list: (roomId) => listTerminalTabsAction({ roomId }),
  save: async (roomId, tab) => {
    await createTerminalTabAction({
      roomId,
      branch: tab.branchId,
      id: tab.id,
      label: tab.label,
      harnessKey: tab.harnessKey,
      createdAt: tab.createdAt,
    })
  },
  delete: (roomId, id) => deleteTerminalTabAction({ roomId, id }),
  killSession: (roomId, { terminalSessionId, sandboxName }) =>
    sandboxName
      ? killTerminalSessionAction({ roomId, sandboxName, terminalSessionId })
      : killOrphanedTerminalSessionAction({ roomId, terminalSessionId }),
}
