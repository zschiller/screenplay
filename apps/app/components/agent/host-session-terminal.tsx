"use client"

import { Spinner } from "@workspace/ui/components/spinner"
import { withBasePath } from "@/lib/base-path"
import { useTerminalPane, type PaneConnection } from "./use-terminal-pane"

interface HostSessionTerminalProps {
  /** Stable PTY session key (`screenplay-<name>`). A webview reload reattaches to
   *  the live process; the registry reaps it on exit, so a later run is fresh. */
  sessionKey: string
  /** argv to run in the host `$HOME` PTY — e.g. the `gh auth login` command. */
  command: string[]
  /** Fired when the PTY exits: the setup step's completion signal to re-detect. */
  onExit?: () => void
}

/**
 * The **host-session** wrapper over the shared xterm core ({@link useTerminalPane},
 * ADR 0014): a visible inline terminal that runs a command in the user's `$HOME`
 * with no sandbox, room, or membership gate. Settings mounts it to run
 * `gh auth login` so the one-time code and any errors are visible, and the host
 * `gh` the resolver reads is the one that gets authenticated.
 *
 * It resolves the local server's `ws` origin from `/api/terminal/host` (the
 * gate-free host-session analogue of `/api/terminal/url`), then hands the shared
 * core the session key + command as the wire protocol's `?arg=`s.
 */
export function HostSessionTerminal({
  sessionKey,
  command,
  onExit,
}: HostSessionTerminalProps) {
  const { hostRef, state } = useTerminalPane({
    // Reconnect if the command changes; a stable key otherwise keeps one PTY.
    connectKey: [sessionKey, ...command].join(" "),
    endedMessage: "Sign-in finished — checking connection…",
    onExit,
    resolve: async (): Promise<PaneConnection> => {
      try {
        const res = await fetch(withBasePath("/api/terminal/host"))
        if (!res.ok)
          return { ok: false, message: "Couldn't start the terminal." }
        const body = (await res.json()) as { url: string }
        return {
          ok: true,
          url: body.url,
          token: "",
          args: [sessionKey, ...command],
        }
      } catch {
        return { ok: false, message: "Couldn't start the terminal." }
      }
    },
  })

  return (
    <div className="relative h-72 overflow-hidden rounded-lg border bg-background">
      <div
        ref={hostRef}
        className="absolute inset-0 h-full w-full bg-background text-foreground"
      />
      {state.status !== "ready" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background px-6 text-center text-sm text-muted-foreground">
          {state.status === "loading" ? (
            <span className="flex items-center gap-2">
              <Spinner className="size-4" /> Starting terminal…
            </span>
          ) : (
            <span>{state.message}</span>
          )}
        </div>
      )}
    </div>
  )
}
