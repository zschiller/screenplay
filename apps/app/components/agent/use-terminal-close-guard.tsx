"use client"

import { useCallback, useRef, useState } from "react"

import { ConfirmDialog } from "@/components/confirm-dialog"
import { terminalSessionActivityAction } from "@/lib/terminal-tabs-actions"
import type { BranchData, TerminalTabData } from "@/lib/types"

/** How long the close waits to learn what's running before it asks anyway. */
const CHECK_TIMEOUT_MS = 3000

type PendingClose = {
  tab: TerminalTabData
  nextSelectedId?: string
  /** What's running (`claude`), or `null` when the check couldn't tell. */
  command: string | null
}

/**
 * Closing a terminal tab kills its session, including a running Claude Code
 * or Codex turn. This asks first, but only when something is running: an idle
 * shell (or a Workspace whose sandbox isn't up) closes at once, as before. If
 * the check fails or is slow, it asks rather than guess.
 *
 * Returns `requestClose` for the tab's ×, and the dialog to render.
 */
export function useTerminalCloseGuard({
  roomId,
  agent,
  onClose,
}: {
  roomId: string
  agent: BranchData | null
  onClose: (tabId: string, nextSelectedId?: string) => void
}) {
  const [pending, setPending] = useState<PendingClose | null>(null)
  const checking = useRef(new Set<string>())

  const requestClose = useCallback(
    async (tab: TerminalTabData, nextSelectedId?: string) => {
      if (checking.current.has(tab.id)) return
      if (!agent?.sandboxName || agent.status !== "running") {
        onClose(tab.id, nextSelectedId)
        return
      }
      checking.current.add(tab.id)
      let command: string | null
      try {
        const running = await Promise.race([
          terminalSessionActivityAction({
            roomId,
            sandboxName: agent.sandboxName,
            terminalSessionId: tab.terminalSessionId,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("timed out")), CHECK_TIMEOUT_MS)
          ),
        ])
        if (running === null) {
          onClose(tab.id, nextSelectedId)
          return
        }
        command = running
      } catch (err) {
        console.error("Couldn’t check the terminal before closing", err)
        command = null
      } finally {
        checking.current.delete(tab.id)
      }
      setPending({ tab, nextSelectedId, command })
    },
    [roomId, agent, onClose]
  )

  const dialog = (
    <ConfirmDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) setPending(null)
      }}
      verb="Close"
      itemName={pending?.tab.label}
      itemNoun="terminal"
      description={
        pending?.command
          ? `Closing the terminal stops ${pending.command}, which is still running.`
          : "Closing the terminal stops anything running in it."
      }
      onConfirm={() => {
        if (!pending) return
        onClose(pending.tab.id, pending.nextSelectedId)
        setPending(null)
      }}
    />
  )

  return { requestClose, dialog }
}
