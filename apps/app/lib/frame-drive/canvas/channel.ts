import { randomUUID } from "node:crypto"

import {
  isDriveOp,
  type DriveOp,
  type DriveResult,
} from "@/lib/frame-drive/contract"
import type {
  CanvasAnswer,
  FrameWhere,
  PageInView,
  ServerToCanvas,
} from "@/lib/frame-drive/canvas/protocol"

/**
 * The asker's-canvas channel: the server's one way to reach the canvas of the
 * person who asked the agent, where a page in their own canvas (a frame on
 * the Mac, a Mockup anywhere) runs. It sends ops, location queries, snapshot
 * reads and reveals, waits for each answer with its own timeout, and reads
 * it; the canvas runs each through its relay (`relay.ts`). Only the transport
 * differs between runtimes: a WebSocket per canvas on the Mac (`mac/`), the
 * Room's doc plus an answer rendezvous on hosted (`view/`).
 *
 * Bringing a frame into view (#1383, #1390) is the channel's, not a
 * backend's: only the asker's canvas can move their view, whichever backend
 * drives the frame (a hosted shared frame's is its shared browser).
 */

/** How the channel reaches the asker's canvas. */
export interface CanvasTransport {
  /**
   * Deliver `message` to the canvas and wait up to `timeoutMs` for its
   * answer: the answer, or why none came (no canvas, it closed, it didn't
   * answer in time).
   */
  ask(
    message: ServerToCanvas,
    timeoutMs: number
  ): Promise<CanvasAnswer | string>
}

export interface AskerCanvas {
  /** Run one op in the frame, through the canvas's relay. */
  run(frameId: string, op: DriveOp): Promise<DriveResult>
  /** Where the frame sits in the canvas window, or why that's unknown. */
  where(frameId: string): Promise<FrameWhere | string>
  /** The page as it is in the person's view, or why there's none. */
  snapshot(frameId: string): Promise<PageInView | string>
  /** Bring the frame into the asker's view, and nobody else's. Null when it
   *  did, otherwise why not. */
  reveal(frameId: string): Promise<string | null>
}

export type AskerCanvasTimeouts = {
  /** How long a gesture may take in the page. */
  opTimeoutMs?: number
  /** How long a read of where the frame is, or of its page, may take. */
  readTimeoutMs?: number
  /** How long the canvas may take to lay a new frame out and move to it. */
  revealTimeoutMs?: number
}

const OP_TIMEOUT_MS = 15_000
const READ_TIMEOUT_MS = 8_000
const REVEAL_TIMEOUT_MS = 5_000

const UNEXPECTED = "The canvas sent an unexpected answer."
const NOT_LOADED = "The page isn't loaded on the canvas, or it didn't answer."
const NOT_REVEALED = "The canvas couldn't bring it into view."

export function askerCanvas(
  transport: CanvasTransport,
  timeouts: AskerCanvasTimeouts = {}
): AskerCanvas {
  const opTimeoutMs = timeouts.opTimeoutMs ?? OP_TIMEOUT_MS
  const readTimeoutMs = timeouts.readTimeoutMs ?? READ_TIMEOUT_MS
  const revealTimeoutMs = timeouts.revealTimeoutMs ?? REVEAL_TIMEOUT_MS

  return {
    async run(frameId, op) {
      // Only the contract's ops ever leave the server.
      if (!isDriveOp(op)) {
        return { status: "failed", reason: "unknown drive op" }
      }
      const answer = await transport.ask(
        { type: "op", id: randomUUID(), frameId, op },
        opTimeoutMs
      )
      if (typeof answer === "string") {
        return { status: "unavailable", reason: answer }
      }
      return answer.type === "result"
        ? answer.result
        : { status: "failed", reason: UNEXPECTED }
    },

    async where(frameId) {
      const answer = await transport.ask(
        { type: "where", id: randomUUID(), frameId },
        readTimeoutMs
      )
      if (typeof answer === "string") return answer
      return answer.type === "where" ? answer.where : UNEXPECTED
    },

    async snapshot(frameId) {
      const answer = await transport.ask(
        { type: "snapshot", id: randomUUID(), frameId },
        readTimeoutMs
      )
      if (typeof answer === "string") return answer
      if (answer.type !== "snapshot") return UNEXPECTED
      return answer.snapshot ?? NOT_LOADED
    },

    async reveal(frameId) {
      const answer = await transport.ask(
        { type: "reveal", id: randomUUID(), frameId },
        revealTimeoutMs
      )
      if (typeof answer === "string") return answer
      return answer.type === "revealed" && answer.ok ? null : NOT_REVEALED
    },
  }
}
