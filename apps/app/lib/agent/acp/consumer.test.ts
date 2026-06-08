import { describe, expect, it, vi } from "vitest"

// `run-state` binds to the live Drizzle handle at import time; this test drives
// it through an injected in-memory repo, so stub the db boundary that would
// otherwise demand a real DATABASE_URL (mirrors engine.test.ts).
vi.mock("@/lib/db", () => ({ db: {} }))

import { AcpUpdateConsumer, type AcpConsumerPorts } from "./consumer"
import type { EngineUpdate } from "./engine-seam"
import type { AcpMessageRecord } from "./record"
import { agentMessageChunk, type SessionUpdate } from "./schema"
import { createRunState, type RunStateRepo, type RunStatus } from "../run-state"

/**
 * In-memory ports + a real `createRunState` over an in-memory run row, so the
 * consumer drives the genuine transition guards (legal edges, terminal no-op).
 * We assert on the *observable outcome* — the broadcasts, the persisted
 * ACP-native records, and the recorded run status — never on how they were
 * produced. Mirrors `engine.test.ts`'s `fakeRuns`.
 */
function harness(seedStatus: RunStatus = "running") {
  const broadcasts: SessionUpdate[] = []
  const errors: string[] = []
  const records: AcpMessageRecord[] = []
  let ends = 0

  const rows = new Map<string, RunStatus>([["run_1", seedStatus]])
  const repo: RunStateRepo = {
    async loadStatus(id) {
      return rows.get(id) ?? null
    },
    async applyTransition(id, to) {
      rows.set(id, to)
    },
    async supersedeActiveRuns() {},
    async insertRunning() {
      return "run_1"
    },
    async pauseForPlan() {},
    async resolvePlan() {
      return null
    },
  }
  const runState = createRunState(repo)

  const ports: AcpConsumerPorts = {
    async broadcastUpdate(update) {
      broadcasts.push(update)
    },
    async broadcastError(message) {
      errors.push(message)
    },
    async broadcastEnd() {
      ends++
    },
    async appendAgentMessage(record) {
      records.push(record)
    },
    async transition(to) {
      await runState.transition("run_1", to)
    },
  }

  return {
    consumer: new AcpUpdateConsumer(ports),
    broadcasts,
    errors,
    records,
    statusOf: () => rows.get("run_1"),
    endCount: () => ends,
  }
}

async function feed(consumer: AcpUpdateConsumer, updates: EngineUpdate[]) {
  for (const u of updates) await consumer.handle(u)
}

describe("AcpUpdateConsumer — text path", () => {
  it("broadcasts each chunk, persists one ACP-native agent record, completes the run, and ends the stream", async () => {
    const h = harness()
    await feed(h.consumer, [
      { kind: "session_update", update: agentMessageChunk("Hel") },
      { kind: "session_update", update: agentMessageChunk("lo") },
      { kind: "done", stopReason: "end_turn" },
    ])

    // Every chunk is broadcast ACP-shaped so clients render the live stream.
    expect(h.broadcasts).toEqual([
      agentMessageChunk("Hel"),
      agentMessageChunk("lo"),
    ])
    // The whole turn persists as one ACP-native agent record.
    expect(h.records).toEqual<AcpMessageRecord[]>([
      { role: "agent", content: [{ type: "text", text: "Hello" }] },
    ])
    expect(h.statusOf()).toBe("completed")
    expect(h.endCount()).toBe(1)
  })

  it("does not persist a record for a turn that produced no text", async () => {
    const h = harness()
    await feed(h.consumer, [{ kind: "done", stopReason: "end_turn" }])

    expect(h.records).toEqual([])
    expect(h.statusOf()).toBe("completed")
    expect(h.endCount()).toBe(1)
  })

  it("records a genuine error as failed and surfaces the message", async () => {
    const h = harness()
    await feed(h.consumer, [
      { kind: "session_update", update: agentMessageChunk("partial") },
      { kind: "error", message: "model exploded" },
    ])

    expect(h.errors).toEqual(["model exploded"])
    expect(h.statusOf()).toBe("failed")
    // No durable record on failure — the partial text was broadcast only.
    expect(h.records).toEqual([])
    expect(h.endCount()).toBe(1)
  })

  // A user `/stop` (or supersession) already moved the run to a terminal state
  // before the abort surfaced as an error. The consumer's `failed` transition
  // must no-op so the recorded outcome (aborted) is preserved.
  for (const terminal of ["aborted", "superseded"] as const) {
    it(`preserves an already-terminal (${terminal}) run on a stop`, async () => {
      const h = harness(terminal)
      await feed(h.consumer, [{ kind: "error", message: "Stopped by user" }])

      expect(h.errors).toEqual(["Stopped by user"])
      expect(h.statusOf()).toBe(terminal)
      expect(h.endCount()).toBe(1)
    })
  }

  it("ignores a done after a terminal error (single close)", async () => {
    const h = harness()
    await feed(h.consumer, [
      { kind: "error", message: "boom" },
      { kind: "done", stopReason: "end_turn" },
    ])

    expect(h.errors).toEqual(["boom"])
    expect(h.statusOf()).toBe("failed")
    expect(h.endCount()).toBe(1)
  })
})
