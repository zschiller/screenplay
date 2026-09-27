"use client"

import { Spinner } from "@workspace/ui/components/spinner"
import { tmuxSessionName } from "@/lib/terminal/session"
import { withBasePath } from "@/lib/base-path"
import { useTerminalPane, type PaneConnection } from "./use-terminal-pane"
import type { SandboxStatus } from "@/lib/types"

interface TerminalTabProps {
  /** Shared live-view identity — collaborators opening the same id co-view one PTY. */
  sessionId: string
  roomId: string
  /** The agent's sandbox the terminal attaches to. Undefined while the sandbox
   *  is still provisioning, in which case there's nothing to attach to yet. */
  sandboxName?: string
  /** The Branch's sandbox lifecycle status. While it's booting/resuming (e.g. a
   *  rebuilt VM after the old one was reclaimed) we hold off connecting and show
   *  provisioning feedback; once it's "running" we connect (#260). */
  sandboxStatus?: SandboxStatus
  /** The harness this tab launches into (`Harness.key`, e.g. "claude-code").
   *  The server resolves it → the launch argv; undefined (a pre-#285 tab) opens
   *  a plain shell. */
  harnessKey?: string
}

type OverlayState =
  | { status: "idle" }
  | { status: "provisioning" }
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string }

/**
 * The in-sandbox BYO-harness terminal tab — the **sandbox** wrapper over the
 * shared xterm core ({@link useTerminalPane}, ADR 0014). It owns only the
 * sandbox-specific parts: the provisioning gate (nothing to attach to until the
 * VM is running) and resolving the membership-gated daemon URL.
 *
 * `POST /api/terminal/url` boots the ttyd daemon via `ensureTerminal` and gates
 * on room membership (`issueTerminalCredential` → `canAccess`), handing back the
 * daemon's URL plus a short-lived credential; on the desktop build it hands back
 * the local node-pty server's `ws` origin. The shared core opens the WebSocket
 * and drives ttyd's wire protocol from there (input, output, PTY resize).
 */
export function TerminalTab({
  sessionId,
  roomId,
  sandboxName,
  sandboxStatus,
  harnessKey,
}: TerminalTabProps) {
  // The pre-connection status is a pure function of the props: no sandbox yet
  // means "idle"; a sandbox that's still booting/resuming means "provisioning".
  // Either keeps `connectKey` null so the shared core stays idle (no socket);
  // once we're ready the composite key connects, and it re-connects if the
  // sandbox cycles (a status change is part of the key).
  const notReady: "idle" | "provisioning" | null = !sandboxName
    ? "idle"
    : sandboxStatus === "creating" || sandboxStatus === "starting"
      ? "provisioning"
      : null

  const connectKey = notReady
    ? null
    : [
        roomId,
        sessionId,
        sandboxName,
        sandboxStatus ?? "",
        harnessKey ?? "",
      ].join(" ")

  const { hostRef, state } = useTerminalPane({
    connectKey,
    resolve: async (): Promise<PaneConnection> => {
      try {
        const res = await fetch(withBasePath("/api/terminal/url"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room: roomId,
            session: sessionId,
            sandboxName,
            harnessKey,
          }),
        })
        if (!res.ok) {
          return {
            ok: false,
            message:
              res.status === 403
                ? "You don't have access to this terminal."
                : res.status === 401
                  ? "Sign in to open a terminal."
                  : "Couldn't reach the sandbox terminal.",
          }
        }
        const body = (await res.json()) as {
          url: string
          token: string
          basicAuth?: string
          launchArgv?: string[]
        }
        // Under `ttyd-credential` the strategy returns the daemon's `--credential`
        // (`user:pass`) as `basicAuth`; ttyd validates the handshake `AuthToken`
        // against `base64(user:pass)`, so present it base64-encoded — moving the
        // shell secret onto the WS handshake and out of the URL's leaky channels.
        // Under `bearer` there is no `basicAuth` and the decorative minted token
        // rides along exactly as before (the daemon runs unauthenticated).
        const token = body.basicAuth ? btoa(body.basicAuth) : body.token
        // The tab's session name is ttyd's first `?arg=` (the per-session
        // attach-or-create key); the server-resolved harness launch argv follows.
        // Absent/empty argv means a plain shell.
        return {
          ok: true,
          url: body.url,
          token,
          args: [tmuxSessionName(sessionId), ...(body.launchArgv ?? [])],
        }
      } catch {
        return { ok: false, message: "Couldn't reach the sandbox terminal." }
      }
    },
  })

  // Provisioning/idle come from the props; loading/error come from the shared
  // core — combine them into one overlay exactly as the pre-extraction tab did.
  const overlay: OverlayState =
    notReady === "provisioning"
      ? { status: "provisioning" }
      : notReady === "idle"
        ? { status: "idle" }
        : state

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={hostRef}
          className="absolute inset-0 h-full w-full bg-background text-foreground"
        />
        {overlay.status !== "ready" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background px-6 text-center text-sm text-balance text-muted-foreground">
            {overlay.status === "loading" ? (
              <span className="flex items-center gap-2">
                <Spinner className="size-4" /> Starting terminal…
              </span>
            ) : overlay.status === "provisioning" ? (
              <span className="flex items-center gap-2">
                <Spinner className="size-4" /> Waiting for the sandbox to start…
              </span>
            ) : overlay.status === "error" ? (
              <span className="max-w-sm">{overlay.message}</span>
            ) : (
              <span>Waiting for the sandbox to start…</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
