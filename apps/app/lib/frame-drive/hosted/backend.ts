import "server-only"

import { randomUUID } from "node:crypto"
import WebSocket from "ws"

import { AGENT_PARTY } from "@/lib/canvas/frame-control"
import {
  isDriveOp,
  isGesture,
  type DriveOp,
  type DriveResult,
  type DriveScreenshotResult,
  type FrameDriveBackend,
} from "@/lib/frame-drive/contract"
import type {
  AgentFrame,
  FrameStreamClientMessage,
  FrameStreamServerMessage,
} from "@/lib/frame-stream/protocol"
import { agentGrant, viewToken } from "@/lib/frame-stream/token"

/**
 * The hosted Frame Drive backend (#1396): the agent's ops go to the frame's
 * one shared browser, over the Workspace's Frame Stream
 * (`lib/sandbox-bridge/frame-stream.mjs`), which applies each gesture as real
 * input over CDP. So nothing the Mac can't do (focus, typing keys, Tab,
 * native popups) is a gap here, hover is the browser's own rather than
 * forced, and everyone watching the frame sees each step live. The screenshot is the shared page itself.
 *
 * The app connects to the stream as the agent. Each gesture carries an agent
 * grant signed here, after the agent's driver asked Frame Control; the stream
 * refuses it when a person's newer grant holds the frame (they took over).
 */

/** A shared frame the agent can reach: where it starts if it isn't
 *  running, and the Workspace's stream. */
export type HostedFrame = Omit<AgentFrame, "frame"> & {
  stream: { url: string; key: string }
}

/** How long an op may take, starting the frame's browser included. */
const OP_TIMEOUT_MS = 45_000
/** An agent connection nobody used for this long closes. */
const IDLE_CLOSE_MS = 60_000

export interface HostedBackendDeps {
  /** The frame, or why it can't be driven. */
  frame(frameId: string): Promise<HostedFrame | string>
  /** The stream couldn't be reached: whatever said it runs may be stale. */
  unreachable?(stream: HostedFrame["stream"]): void
  opTimeoutMs?: number
}

export function hostedFrameDriveBackend(
  deps: HostedBackendDeps
): FrameDriveBackend {
  const opTimeoutMs = deps.opTimeoutMs ?? OP_TIMEOUT_MS
  return {
    async unavailable(frameId) {
      // A shared frame runs whether or not anyone has the canvas open.
      if (frameId === undefined) return null
      const frame = await deps.frame(frameId)
      return typeof frame === "string" ? frame : null
    },

    async run(frameId, op: DriveOp): Promise<DriveResult> {
      // Only the contract's ops ever leave the server.
      if (!isDriveOp(op))
        return { status: "failed", reason: "unknown drive op" }
      const frame = await deps.frame(frameId)
      if (typeof frame === "string") {
        return { status: "unavailable", reason: frame }
      }
      const grant = isGesture(op)
        ? agentGrant(frame.stream.key, frameId).token
        : undefined
      const answer = await ask(
        frame.stream,
        (id) => ({ t: "agent", id, op, grant, ...where(frameId, frame) }),
        opTimeoutMs
      )
      if (typeof answer === "string") {
        if (answer === STREAM_DOWN) deps.unreachable?.(frame.stream)
        return { status: "unavailable", reason: answer }
      }
      return answer.t === "agent-result"
        ? answer.result
        : { status: "failed", reason: "unexpected answer" }
    },

    async screenshot(frameId): Promise<DriveScreenshotResult> {
      const frame = await deps.frame(frameId)
      if (typeof frame === "string") {
        return { status: "unavailable", reason: frame }
      }
      const answer = await ask(
        frame.stream,
        (id) => ({ t: "agent-shot", id, ...where(frameId, frame) }),
        opTimeoutMs
      )
      if (typeof answer === "string") {
        if (answer === STREAM_DOWN) deps.unreachable?.(frame.stream)
        return { status: "unavailable", reason: answer }
      }
      if (answer.t !== "agent-shot" || !answer.shot) {
        return {
          status: "unavailable",
          reason:
            (answer.t === "agent-shot" && answer.reason) ||
            "The shared browser sent no picture.",
        }
      }
      return {
        status: "shot",
        shot: {
          data: Buffer.from(answer.shot.data, "base64"),
          mediaType: answer.shot.mediaType,
        },
      }
    },
  }
}

function where(frameId: string, frame: HostedFrame): AgentFrame {
  return {
    frame: frameId,
    route: frame.route,
    width: frame.width,
    height: frame.height,
  }
}

// ---------- the agent's connections, one per Workspace stream ----------

type Answer = Extract<
  FrameStreamServerMessage,
  { t: "agent-result" } | { t: "agent-shot" }
>

type AgentConnection = {
  socket: WebSocket
  ready: Promise<string | null>
  pending: Map<string, (answer: Answer | string) => void>
  idle: ReturnType<typeof setTimeout> | null
}

// On globalThis: the in-process turn and the harness MCP route can load this
// module in separate module graphs.
const CONNECTIONS_KEY = Symbol.for("screenplay.hostedFrameDriveConnections")
type ConnectionsHost = typeof globalThis & {
  [CONNECTIONS_KEY]?: Map<string, AgentConnection>
}
function connections(): Map<string, AgentConnection> {
  const host = globalThis as ConnectionsHost
  host[CONNECTIONS_KEY] ??= new Map()
  return host[CONNECTIONS_KEY]
}

const STREAM_DOWN =
  "The Workspace's shared browser isn't reachable right now. Its Sandbox may be starting or asleep."

function connect(stream: HostedFrame["stream"]): AgentConnection {
  const existing = connections().get(stream.url)
  if (existing && existing.socket.readyState <= WebSocket.OPEN) return existing

  const socket = new WebSocket(stream.url)
  const conn: AgentConnection = {
    socket,
    pending: new Map(),
    idle: null,
    ready: new Promise((resolve) => {
      const fail = () => resolve(STREAM_DOWN)
      socket.once("error", fail)
      socket.once("close", fail)
      socket.once("open", () => {
        socket.send(
          JSON.stringify({
            t: "auth",
            token: viewToken(stream.key, AGENT_PARTY).token,
          } satisfies FrameStreamClientMessage)
        )
      })
      socket.on("message", (data, isBinary) => {
        if (isBinary) return
        let msg: FrameStreamServerMessage
        try {
          msg = JSON.parse(String(data)) as FrameStreamServerMessage
        } catch {
          return
        }
        if (msg.t === "ready") return resolve(null)
        if (msg.t !== "agent-result" && msg.t !== "agent-shot") return
        const done = conn.pending.get(msg.id)
        conn.pending.delete(msg.id)
        done?.(msg)
      })
    }),
  }
  socket.on("error", () => {})
  socket.on("close", () => {
    if (connections().get(stream.url) === conn) connections().delete(stream.url)
    if (conn.idle) clearTimeout(conn.idle)
    for (const done of conn.pending.values()) done(STREAM_DOWN)
    conn.pending.clear()
  })
  connections().set(stream.url, conn)
  return conn
}

async function ask(
  stream: HostedFrame["stream"],
  message: (id: string) => FrameStreamClientMessage,
  timeoutMs: number
): Promise<Answer | string> {
  const conn = connect(stream)
  const down = await conn.ready
  if (down) return down
  if (conn.idle) clearTimeout(conn.idle)
  const id = randomUUID()
  const answer = await new Promise<Answer | string>((resolve) => {
    const timer = setTimeout(() => {
      conn.pending.delete(id)
      resolve("The shared browser didn't answer in time.")
    }, timeoutMs)
    conn.pending.set(id, (answer) => {
      clearTimeout(timer)
      resolve(answer)
    })
    conn.socket.send(JSON.stringify(message(id)))
  })
  if (conn.pending.size === 0) {
    conn.idle = setTimeout(() => conn.socket.close(), IDLE_CLOSE_MS)
    conn.idle.unref?.()
  }
  return answer
}
