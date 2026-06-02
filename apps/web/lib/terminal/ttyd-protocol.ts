/**
 * Wire codec for ttyd's WebSocket protocol, pinned to the `1.7.7` static binary
 * the sandbox launches (`lib/sandbox/terminal.ts`). The framing was validated
 * byte-for-byte against a live daemon in spike #255 — see ADR 0002's
 * 2026-06-01 addendum for the source of truth.
 *
 * Every frame is `[1 command byte][UTF-8 payload]` and travels as a binary
 * WebSocket message. The one exception is the opening handshake: its first byte
 * is `{` (`0x7b`), which doubles as ttyd's `JSON_DATA` command marker, so the
 * handshake is just the JSON bytes with no separate prefix.
 *
 * This module is pure (no DOM, no `xterm`) so the codec is unit-testable in the
 * Node test environment and the client component stays a thin transport shim.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Client → server command bytes. */
const INPUT = "0"
const RESIZE = "1"

/** Server → client command bytes. */
const OUTPUT = "0"
const SET_WINDOW_TITLE = "1"
const SET_PREFERENCES = "2"

/** Prefix a UTF-8 payload with a single-byte command marker. */
function frame(command: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(payload.length + 1)
  out[0] = command.charCodeAt(0)
  out.set(payload, 1)
  return out
}

/**
 * The opening handshake. ttyd waits for exactly one `JSON_DATA` message before
 * it spawns the PTY; the message is the JSON itself (leading `{` is the
 * command marker). `authToken` is `""` when the daemon runs without
 * `--credential` (our case) but is carried through so a future
 * credential-checking daemon validates the minted token.
 */
export function encodeHandshake(input: {
  authToken: string
  columns: number
  rows: number
}): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      AuthToken: input.authToken,
      columns: input.columns,
      rows: input.rows,
    }),
  )
}

/** Raw keystroke bytes from the terminal, framed as an `INPUT` message. */
export function encodeInput(data: string): Uint8Array {
  return frame(INPUT, encoder.encode(data))
}

/**
 * Tell the daemon to resize the real PTY. The spike confirmed this reaches the
 * PTY (`stty size` reflected the new geometry), not just xterm's local view.
 */
export function encodeResize(columns: number, rows: number): Uint8Array {
  return frame(RESIZE, encoder.encode(JSON.stringify({ columns, rows })))
}

export type TtydServerMessage =
  /** Raw PTY bytes — feed straight to `term.write()`. */
  | { type: "output"; data: Uint8Array }
  | { type: "title"; title: string }
  | { type: "preferences"; raw: string }
  | { type: "unknown"; command: string }

/**
 * Decode a binary server frame. `output` keeps its payload as raw bytes so
 * multi-byte UTF-8 sequences split across frames are reassembled by xterm's own
 * decoder rather than mangled by an eager `TextDecoder.decode` here.
 */
export function decodeServerMessage(data: Uint8Array): TtydServerMessage {
  if (data.length === 0) return { type: "unknown", command: "" }
  const command = String.fromCharCode(data[0]!)
  const payload = data.subarray(1)
  switch (command) {
    case OUTPUT:
      return { type: "output", data: payload }
    case SET_WINDOW_TITLE:
      return { type: "title", title: decoder.decode(payload) }
    case SET_PREFERENCES:
      return { type: "preferences", raw: decoder.decode(payload) }
    default:
      return { type: "unknown", command }
  }
}

/**
 * Turn the membership-gated daemon URL (`sandbox.domain(TERMINAL_PORT)`, an
 * `https://…vercel.run` origin) into the `wss://…/ws` endpoint ttyd serves its
 * WebSocket on.
 *
 * `commandArgs` are appended in order as ttyd's repeated `?arg=` URL arguments
 * (the daemon runs with `--url-arg`): ttyd forwards each as one argv element on
 * its base command `tmux new -A -s`. The first arg is the tab's session name,
 * yielding the per-session attach-or-create `tmux new -A -s screenplay-<tabId>`
 * (#259); any following args are the harness launch command
 * (`sh -c '<harness>; exec $SHELL'`, #285), so a new tab lands straight in the
 * harness while `tmux new -A` ignores the command when reattaching to a live
 * session. Pass none and the bare `/ws` endpoint is returned.
 */
export function terminalWebSocketUrl(
  httpUrl: string,
  commandArgs: string[] = [],
): string {
  const url = new URL(httpUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = `${url.pathname.replace(/\/$/, "")}/ws`
  for (const arg of commandArgs) url.searchParams.append("arg", arg)
  return url.toString()
}

/** WebSocket subprotocol ttyd selects; sent on connect. */
export const TTYD_SUBPROTOCOL = "tty"
