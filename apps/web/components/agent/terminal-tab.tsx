"use client"

import { useEffect, useState } from "react"
import { SquareTerminal } from "lucide-react"
import { Spinner } from "@workspace/ui/components/spinner"

interface TerminalTabProps {
  /** Shared live-view identity — collaborators opening the same id co-view one PTY. */
  sessionId: string
  roomId: string
  /** The agent's sandbox the terminal attaches to. Undefined while the sandbox
   *  is still provisioning, in which case there's nothing to attach to yet. */
  sandboxName?: string
}

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string }

/**
 * Body of a terminal tab: the in-sandbox BYO-harness web terminal.
 *
 * Resolves a membership-gated daemon URL from `/api/terminal/url` (which boots
 * the ttyd daemon via `ensureTerminal` and gates on room membership) and embeds
 * the live daemon. It is **not** a Chat Session: nothing here is written to the
 * chat-store, Postgres, or the Y.Doc conversation model — the scrollback lives
 * only in the running daemon and is lost when the sandbox is reclaimed.
 */
export function TerminalTab({ sessionId, roomId, sandboxName }: TerminalTabProps) {
  const [state, setState] = useState<State>({ status: "idle" })

  useEffect(() => {
    if (!sandboxName) {
      setState({ status: "idle" })
      return
    }

    let cancelled = false
    setState({ status: "loading" })
    ;(async () => {
      try {
        const res = await fetch("/api/terminal/url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: roomId, session: sessionId, sandboxName }),
        })
        if (cancelled) return
        if (!res.ok) {
          const message =
            res.status === 403
              ? "You don't have access to this terminal."
              : res.status === 401
                ? "Sign in to open a terminal."
                : "Couldn't reach the sandbox terminal."
          setState({ status: "error", message })
          return
        }
        const { url } = (await res.json()) as { url: string }
        if (!cancelled) setState({ status: "ready", url })
      } catch {
        if (!cancelled) {
          setState({ status: "error", message: "Couldn't reach the sandbox terminal." })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [roomId, sessionId, sandboxName])

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex items-center gap-1.5 border-b border-border px-3 py-1 text-[11px] text-muted-foreground">
        <SquareTerminal className="size-3 shrink-0 text-emerald-700 dark:text-emerald-300" />
        <span>Ephemeral terminal — not saved to chat history.</span>
      </div>
      <div className="relative flex-1 overflow-hidden">
        {state.status === "ready" ? (
          <iframe
            src={state.url}
            title="Sandbox terminal"
            className="absolute inset-0 h-full w-full border-0 bg-black"
            // The terminal is a trusted same-operator surface, but scope the
            // frame to scripts + same-origin-to-itself only as hygiene.
            sandbox="allow-scripts allow-same-origin allow-forms"
            // The daemon URL is effectively a secret bearer link (the daemon
            // is unauthenticated — see ADR 0002). Never leak it via Referer.
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {state.status === "loading" ? (
              <span className="flex items-center gap-2">
                <Spinner className="size-4" /> Starting terminal…
              </span>
            ) : state.status === "error" ? (
              <span>{state.message}</span>
            ) : (
              <span>Waiting for the sandbox to start…</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
