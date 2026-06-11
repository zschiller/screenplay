import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { fileURLToPath } from "node:url"
import { describe, expect, it, vi } from "vitest"

// `run-state` binds to the live Drizzle handle at import time; drive it through
// an in-memory repo instead, so this test needs no DATABASE_URL (mirrors
// consumer.test.ts).
vi.mock("@/lib/db", () => ({ db: {} }))

import { AcpUpdateConsumer, type AcpConsumerPorts } from "./consumer"
import type { EngineUpdate } from "./engine-seam"
import { agentMessageChunk } from "./schema"
import {
  createRunState,
  type RunState,
  type RunStateRepo,
  type RunStatus,
} from "../run-state"
import { chatStore, type ChatBroadcastEvent } from "@/lib/chat-store"
import type { AgentMessage } from "@/lib/agent/types"

/**
 * Multiplayer fan-out verification (issue #380). The load-bearing principle now
 * that broadcasts are ACP-shaped (ADR 0006): **the server is the one ACP peer;
 * the Y.Doc fan-out is the multiplexer (single ACP session in → N browsers out);
 * browsers are never ACP peers.**
 *
 * This is a regression slice over the machinery delivered in #376 — it proves
 * the format change preserved multiplayer rather than quietly breaking it. We
 * exercise the real consumer and the real chat-store; the Room Y.Doc transport
 * is modelled as an ordered append log of {@link ChatBroadcastEvent}s with
 * minted ids, which is exactly what a room's `streamEventsByChat` Y.Array holds
 * and delivers — in order — to every subscriber (see `broadcastChatEventViaDoc`).
 */

/** A Room broadcast envelope before it is scoped to a particular chat. */
type BusEntry = ChatBroadcastEvent extends infer T
  ? T extends { chatId: string }
    ? Omit<T, "chatId">
    : never
  : never

let seq = 0
const freshChatId = () => `browser_${++seq}`

/**
 * In-memory `agent_run` table so the run lifecycle runs its genuine guards
 * (supersede-on-start, terminal no-op) without Postgres.
 */
function memoryRunRepo() {
  const rows = new Map<string, { chatId: string; status: RunStatus }>()
  let n = 0
  const repo: RunStateRepo = {
    async loadStatus(id) {
      return rows.get(id)?.status ?? null
    },
    async applyTransition(id, to) {
      const row = rows.get(id)
      if (row) row.status = to
    },
    async supersedeActiveRuns(chatId) {
      for (const row of rows.values()) {
        if (
          row.chatId === chatId &&
          (row.status === "running" || row.status === "paused_for_plan")
        ) {
          row.status = "superseded"
        }
      }
    },
    async insertRunning(chatId) {
      const id = `run_${++n}`
      rows.set(id, { chatId, status: "running" })
      return id
    },
    async pauseForPlan() {},
    async resolvePlan() {
      return null
    },
  }
  return { repo, rows }
}

const activeRuns = (
  rows: Map<string, { chatId: string; status: RunStatus }>,
  chatId: string
) =>
  [...rows]
    .filter(
      ([, r]) =>
        r.chatId === chatId &&
        (r.status === "running" || r.status === "paused_for_plan")
    )
    .map(([id]) => id)

/**
 * Drive a single ACP session's update stream through the real consumer and
 * capture the ordered Room broadcast it produces. Mints a stable id per event
 * exactly as the broadcast boundary does, so subscribers can dedup. The route
 * opens the turn with a `chat-stream-start` before the consumer runs, so we
 * prepend it here.
 */
async function runConsumerToBus(
  updates: EngineUpdate[],
  opts?: { runState: RunState; runId: string }
): Promise<BusEntry[]> {
  const bus: BusEntry[] = []

  bus.push({ type: "chat-stream-start", id: randomUUID() })

  let runState: RunState
  let runId: string
  if (opts) {
    ;({ runState, runId } = opts)
  } else {
    runState = createRunState(memoryRunRepo().repo)
    runId = await runState.startRun("chat")
  }

  const ports: AcpConsumerPorts = {
    async broadcastUpdate(update) {
      bus.push({ type: "chat-acp-update", id: randomUUID(), update })
    },
    async broadcastError(message) {
      bus.push({
        type: "chat-control",
        id: randomUUID(),
        control: { kind: "error", message },
      })
    },
    async broadcastEnd() {
      bus.push({ type: "chat-stream-end", id: randomUUID() })
    },
    // The durable record append / tool-call upsert are not part of the
    // broadcast fan-out — browsers render the live stream, not the persisted
    // log — so they are no-ops here.
    async appendRecord() {},
    async upsertToolCall() {},
    async transition(to) {
      await runState.transition(runId, to)
    },
    // Plan-gate ports — unused by the text-only fan-out streams here.
    async broadcastPermissionRequest() {},
    async pauseForPlan() {},
  }

  const consumer = new AcpUpdateConsumer(ports)
  for (const u of updates) await consumer.handle(u)
  return bus
}

/**
 * Replay a Room broadcast into one browser's store (a distinct `chatId` is an
 * isolated state slot — a faithful proxy for an independent browser ChatStore),
 * capturing the messages snapshot after every event so we can compare not just
 * the final state but the *order* in which it was reached.
 */
function observeStream(chatId: string, bus: BusEntry[]): AgentMessage[][] {
  const snapshots: AgentMessage[][] = []
  for (const entry of bus) {
    chatStore.handleBroadcastEvent({ ...entry, chatId } as ChatBroadcastEvent)
    snapshots.push(chatStore.getSnapshot(chatId).messages)
  }
  return snapshots
}

describe("ACP seam — multiplayer fan-out (single ACP session → N Room subscribers)", () => {
  it("is observed identically and in the same order by multiple Room subscribers", async () => {
    const bus = await runConsumerToBus([
      { kind: "session_update", update: agentMessageChunk("Hel") },
      { kind: "session_update", update: agentMessageChunk("lo, ") },
      { kind: "session_update", update: agentMessageChunk("world") },
      { kind: "done", stopReason: "end_turn" },
    ])

    // Three browsers, each its own isolated store, each subscribed to the one
    // Room and fed the identical ordered event log.
    const chatIds = [freshChatId(), freshChatId(), freshChatId()]
    const observed = chatIds.map((chatId) => observeStream(chatId, bus))

    // Every subscriber walks the identical sequence of states, in order —
    // single ACP session in, N browsers out, with no divergence.
    for (const sequence of observed) expect(sequence).toEqual(observed[0])

    // ...and lands on the same final reply with streaming closed.
    expect(observed[0].at(-1)).toEqual([
      { role: "assistant", content: "Hello, world" },
    ])
    for (const chatId of chatIds) {
      expect(chatStore.getSnapshot(chatId).isStreaming).toBe(false)
      chatStore.cleanup(chatId)
    }
  })

  it("dedups across the canvas + player-chat-host subscribers (no double-apply)", async () => {
    const bus = await runConsumerToBus([
      { kind: "session_update", update: agentMessageChunk("Hel") },
      { kind: "session_update", update: agentMessageChunk("lo, ") },
      { kind: "session_update", update: agentMessageChunk("world") },
      { kind: "done", stopReason: "end_turn" },
    ])

    // canvas.tsx and player-chat-host.tsx both call `useChatStreamEvents` and
    // route every event into the same store. Deliver the whole stream twice —
    // once per subscriber — as the two hooks would. Without `appliedEventIds`,
    // the deltas would accumulate twice (e.g. "HelHel...") and the stream-end
    // would re-fire; the dedup must make the second delivery a no-op.
    const chatId = freshChatId()
    for (const entry of bus) {
      const event = { ...entry, chatId } as ChatBroadcastEvent
      chatStore.handleBroadcastEvent(event) // canvas subscriber
      chatStore.handleBroadcastEvent(event) // player-chat-host subscriber
    }

    expect(chatStore.getSnapshot(chatId).messages).toEqual([
      { role: "assistant", content: "Hello, world" },
    ])
    expect(chatStore.getSnapshot(chatId).isStreaming).toBe(false)
    chatStore.cleanup(chatId)
  })

  it("serializes writes from any participant into the one session via the run lifecycle", async () => {
    const { repo, rows } = memoryRunRepo()
    const runState = createRunState(repo)

    // Participant A prompts: opens the single live run for the chat.
    const runA = await runState.startRun("chat_shared")
    expect(rows.get(runA)?.status).toBe("running")

    // Participant B prompts the same chat (a different browser, same Room). The
    // run lifecycle supersedes A's run and opens exactly one new live run —
    // there are never two concurrent ACP sessions for the chat.
    const runB = await runState.startRun("chat_shared")
    expect(rows.get(runA)?.status).toBe("superseded")
    expect(rows.get(runB)?.status).toBe("running")
    expect(activeRuns(rows, "chat_shared")).toEqual([runB])

    // The consumer for B's turn drives that one run to completion, broadcasting
    // one ordered stream to every subscriber.
    const bus = await runConsumerToBus(
      [
        { kind: "session_update", update: agentMessageChunk("ok") },
        { kind: "done", stopReason: "end_turn" },
      ],
      { runState, runId: runB }
    )
    expect(rows.get(runB)?.status).toBe("completed")
    expect(bus.map((e) => e.type)).toEqual([
      "chat-stream-start",
      "chat-acp-update",
      "chat-stream-end",
    ])

    // A late transition onto A's abandoned run no-ops (terminal), so the
    // superseded outcome is preserved rather than clobbered.
    await runState.transition(runA, "completed")
    expect(rows.get(runA)?.status).toBe("superseded")
  })
})

/**
 * Structural invariant: browsers are never ACP peers. The server is the sole
 * ACP peer; every browser surface consumes the Room Y.Doc broadcast through the
 * chat store and the `useChatStreamEvents` hook — never an ACP client,
 * transport, broadcast writer, or engine. If a future change wired one of these
 * into browser code, this guard fails.
 */
describe("ACP seam — browsers are never ACP peers", () => {
  const appRoot = fileURLToPath(new URL("../../../", import.meta.url))

  // Server-only surfaces a browser must never import directly.
  const FORBIDDEN = [
    "@agentclientprotocol/sdk", // the genuine ACP wire package
    "@/lib/agent/broadcast", // the server's Y.Doc broadcast writer
    "@/lib/agent/acp/consumer", // the single ACP→state boundary (server)
    "@/lib/agent/acp/engine-seam", // the engine update seam (server)
    "@/lib/agent/acp/in-process-engine", // the server's engine
    "@/lib/yjs/server", // the server-side Y.Doc mutator
  ]

  const BROWSER_SURFACES = [
    "lib/chat-store.ts",
    "components/canvas/canvas.tsx",
    "components/play/player-chat-host.tsx",
  ]

  for (const surface of BROWSER_SURFACES) {
    it(`${surface} opens no ACP connection`, () => {
      const source = readFileSync(`${appRoot}${surface}`, "utf8")
      for (const specifier of FORBIDDEN) {
        expect(source).not.toContain(specifier)
      }
    })
  }
})
