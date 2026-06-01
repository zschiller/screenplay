"use client"

import { useEffect, useRef, useState } from "react"
import { Spinner } from "@workspace/ui/components/spinner"
import "@xterm/xterm/css/xterm.css"
import {
  decodeServerMessage,
  encodeHandshake,
  encodeInput,
  encodeResize,
  terminalWebSocketUrl,
  TTYD_SUBPROTOCOL,
} from "@/lib/terminal/ttyd-protocol"
import { tmuxSessionName } from "@/lib/terminal/session"

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
  | { status: "ready" }
  | { status: "error"; message: string }

/**
 * Normalize any CSS color string (incl. `oklch(...)` from the theme tokens) to a
 * form xterm's color parser understands, by round-tripping it through a canvas
 * fill — the browser resolves it to a hex/rgba string.
 */
function resolveColor(value: string, fallback: string): string {
  const ctx = document.createElement("canvas").getContext("2d")
  if (!ctx) return fallback
  ctx.fillStyle = fallback
  ctx.fillStyle = value
  return ctx.fillStyle
}

/**
 * Body of a terminal tab: the in-sandbox BYO-harness web terminal, rendered as a
 * native `xterm.js` pane wired straight to the ttyd daemon's WebSocket.
 *
 * `POST /api/terminal/url` boots the ttyd daemon via `ensureTerminal` and gates
 * on room membership (`issueTerminalCredential` → `canAccess`), handing back the
 * daemon's `domain(port)` URL plus a short-lived credential. We then open a
 * binary WebSocket to that gated URL (`wss://…/ws`, subprotocol `tty`) and drive
 * ttyd's wire protocol directly — input, output, and PTY resize — per the spike
 * #255 transport decision recorded in ADR 0002.
 *
 * It is **not** a Chat Session: nothing here is written to the chat-store,
 * Postgres, or the Y.Doc conversation model — the scrollback lives only in the
 * running daemon and is lost when the sandbox is reclaimed.
 */
export function TerminalTab({ sessionId, roomId, sandboxName }: TerminalTabProps) {
  const [state, setState] = useState<State>({ status: "idle" })
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sandboxName) {
      setState({ status: "idle" })
      return
    }
    const host = hostRef.current
    if (!host) return

    let cancelled = false
    let cleanup: (() => void) | undefined
    setState({ status: "loading" })
    ;(async () => {
      // 1. Resolve the membership-gated daemon URL + credential — the same gate
      //    that previously guarded the iframe src.
      let url: string
      let token: string
      try {
        const res = await fetch("/api/terminal/url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room: roomId, session: sessionId, sandboxName }),
        })
        if (cancelled) return
        if (!res.ok) {
          setState({
            status: "error",
            message:
              res.status === 403
                ? "You don't have access to this terminal."
                : res.status === 401
                  ? "Sign in to open a terminal."
                  : "Couldn't reach the sandbox terminal.",
          })
          return
        }
        const body = (await res.json()) as { url: string; token: string }
        url = body.url
        token = body.token
      } catch {
        if (!cancelled) {
          setState({ status: "error", message: "Couldn't reach the sandbox terminal." })
        }
        return
      }
      if (cancelled) return

      // 2. Boot xterm. Dynamic-import so the DOM-dependent module never loads
      //    during SSR.
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ])
      if (cancelled) return

      // Match the app's theme + monospace font so the terminal reads as native
      // chrome rather than a foreign embedded page.
      const styles = getComputedStyle(host)
      const fontFamily =
        getComputedStyle(document.documentElement)
          .getPropertyValue("--font-mono")
          .trim() || "ui-monospace, SFMono-Regular, Menlo, monospace"
      const term = new Terminal({
        cursorBlink: true,
        fontFamily,
        fontSize: 13,
        theme: {
          background: resolveColor(styles.backgroundColor, "#000000"),
          foreground: resolveColor(styles.color, "#ffffff"),
          cursor: resolveColor(styles.color, "#ffffff"),
        },
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(host)
      fit.fit()

      // Native copy: with a selection, Cmd/Ctrl+C copies to the clipboard rather
      // than sending an interrupt; paste rides xterm's own textarea handling.
      term.attachCustomKeyEventHandler((e) => {
        if (
          e.type === "keydown" &&
          (e.metaKey || e.ctrlKey) &&
          e.key.toLowerCase() === "c" &&
          term.hasSelection()
        ) {
          void navigator.clipboard?.writeText(term.getSelection())
          return false
        }
        return true
      })

      // 3. Connect straight to the daemon's WebSocket and speak ttyd's protocol.
      //    The tab's tmux session name rides along as ttyd's `?arg=`, so the
      //    daemon attaches-or-creates this tab's own persistent session — a
      //    reload reattaches to the same shell with its process still running.
      const ws = new WebSocket(
        terminalWebSocketUrl(url, tmuxSessionName(sessionId)),
        [TTYD_SUBPROTOCOL],
      )
      ws.binaryType = "arraybuffer"

      ws.onopen = () => {
        // The handshake is the first frame ttyd waits for before spawning the
        // PTY; it carries the fitted geometry so output isn't clipped/wrapped.
        ws.send(encodeHandshake({ authToken: token, columns: term.cols, rows: term.rows }))
        if (!cancelled) setState({ status: "ready" })
        term.focus()
      }
      ws.onmessage = (ev) => {
        if (!(ev.data instanceof ArrayBuffer)) return
        const msg = decodeServerMessage(new Uint8Array(ev.data))
        if (msg.type === "output") term.write(msg.data)
      }
      ws.onerror = () => {
        if (!cancelled) {
          setState({ status: "error", message: "Lost connection to the terminal." })
        }
      }
      ws.onclose = () => {
        if (!cancelled) {
          setState((prev) =>
            prev.status === "ready"
              ? { status: "error", message: "Terminal session ended." }
              : prev,
          )
        }
      }

      const dataSub = term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(encodeInput(data))
      })
      // Propagate resizes to the real PTY. `fit()` adjusts cols/rows, which fires
      // onResize; pre-open resizes are folded into the handshake geometry above.
      const resizeSub = term.onResize(({ cols, rows }) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(encodeResize(cols, rows))
      })
      const observer = new ResizeObserver(() => {
        try {
          fit.fit()
        } catch {
          // The pane can be momentarily zero-sized (tab switch); ignore.
        }
      })
      observer.observe(host)

      cleanup = () => {
        observer.disconnect()
        dataSub.dispose()
        resizeSub.dispose()
        ws.onclose = null
        ws.close()
        term.dispose()
      }
    })()

    return () => {
      cancelled = true
      cleanup?.()
    }
  }, [roomId, sessionId, sandboxName])

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={hostRef}
          className="absolute inset-0 h-full w-full bg-background px-2 py-1 text-foreground"
        />
        {state.status !== "ready" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground">
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
