import { beforeEach, describe, expect, it, vi } from "vitest"

// The engine pulls in server-only modules that bind to the live Drizzle handle
// and the model providers at import time. None of that is exercised here: every
// test drives the loop through an injected run-state machine and stream driver,
// so stub the boundaries that would otherwise demand a real DATABASE_URL or API
// keys.
vi.mock("@/lib/db", () => ({ db: {} }))
vi.mock("@/lib/agent/providers", () => ({ resolveLanguageModel: () => ({}) }))
vi.mock("@/lib/yjs/server", () => ({
  broadcastChatEventViaDoc: vi.fn(async () => {}),
}))
// `toolsetFor` (the default toolset assembly) reaches through the sandbox +
// auth stack, which demands runtime env at import. Every test injects its own
// `tools`, so the default assembly is never called — stub it to keep that chain
// out of the test's import graph.
vi.mock("@/lib/agent/toolset", () => ({ toolsetFor: () => ({}) }))

import { runAgentLoop, type StreamDriver } from "@/lib/agent/engine"
import {
  createRunState,
  type RunStateRepo,
  type RunStatus,
} from "@/lib/agent/run-state"
import { broadcastChatEventViaDoc } from "@/lib/yjs/server"

/**
 * In-memory run table wired through the real `createRunState`, so the loop runs
 * against the genuine transition guards (legal edges, terminal no-op) rather
 * than a hand-rolled stub of them. Tests assert on the *recorded status*, which
 * is the observable outcome this slice is about.
 */
function fakeRuns() {
  const rows = new Map<
    string,
    { chatId: string; status: RunStatus; endedAt: Date | null }
  >()
  let seq = 0
  const repo: RunStateRepo = {
    async loadStatus(id) {
      return rows.get(id)?.status ?? null
    },
    async applyTransition(id, to, endedAt) {
      const row = rows.get(id)
      if (!row) return
      row.status = to
      if (endedAt) row.endedAt = endedAt
    },
    async supersedeActiveRuns() {},
    async insertRunning(chatId) {
      const id = `run_${++seq}`
      rows.set(id, { chatId, status: "running", endedAt: null })
      return id
    },
  }
  return {
    runState: createRunState(repo),
    /** Seed a run in a given state, returning its id. */
    seed(status: RunStatus) {
      const id = `run_${++seq}`
      rows.set(id, { chatId: "chat_1", status, endedAt: null })
      return id
    },
    statusOf: (id: string) => rows.get(id)?.status,
  }
}

/** Capture the `error` messages the loop broadcast via the Y.Doc channel. */
function errorBroadcasts(): string[] {
  return vi
    .mocked(broadcastChatEventViaDoc)
    .mock.calls.map(([, msg]) => msg as Record<string, unknown>)
    .filter((msg) => msg.type === "chat-stream")
    .map((msg) => msg.event as { type?: string; message?: string })
    .filter((event) => event.type === "error")
    .map((event) => event.message ?? "")
}

/** A stream driver that finishes cleanly with the given final messages. */
function finishesWith(messages: unknown[]): StreamDriver {
  return (config) => ({
    consumeStream: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await config.onFinish?.({ response: { messages }, steps: [] } as any)
    },
  })
}

/** A stream driver whose drain throws — i.e. the model loop blew up. */
function throwsWith(error: Error): StreamDriver {
  return () => ({
    consumeStream: async () => {
      throw error
    },
  })
}

/**
 * A long-running stream that only ends when its abort signal trips — the way a
 * live model loop behaves once `/stop` (or a supersede) flips the run. It then
 * throws the abort, exactly as streamText does.
 */
function runsUntilAborted(): StreamDriver {
  return (config) => ({
    consumeStream: async () => {
      while (!config.abortSignal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      throw new Error("aborted")
    },
  })
}

function baseOpts() {
  return {
    chatId: "chat_1",
    roomId: "room_1",
    systemPrompt: "sys",
    model: "anthropic:test",
    tools: {},
    messages: [],
  }
}

describe("runAgentLoop outcomes", () => {
  beforeEach(() => {
    // The Y.Doc broadcast mock is module-level; reset its call log so each
    // test's `errorBroadcasts()` reflects only its own run.
    vi.mocked(broadcastChatEventViaDoc).mockClear()
  })

  it("records a clean finish as completed", async () => {
    const runs = fakeRuns()
    const runId = runs.seed("running")

    await runAgentLoop({
      ...baseOpts(),
      runId,
      runState: runs.runState,
      startStream: finishesWith([]),
    })

    expect(runs.statusOf(runId)).toBe("completed")
  })

  it("records a thrown error as failed and broadcasts the real error", async () => {
    const runs = fakeRuns()
    const runId = runs.seed("running")

    await runAgentLoop({
      ...baseOpts(),
      runId,
      runState: runs.runState,
      startStream: throwsWith(new Error("model exploded")),
    })

    expect(runs.statusOf(runId)).toBe("failed")
    // The failure surfaces the real message — not the blanket "Stopped by user".
    expect(errorBroadcasts()).toContain("model exploded")
  })

  // The between-steps watchdog asks "is my run still running?" via isRunActive,
  // so it halts whether the run was aborted by /stop or superseded by a newer
  // message — and must never overwrite that already-recorded outcome.
  for (const terminal of ["aborted", "superseded"] as const) {
    it(`halts a no-longer-running (${terminal}) run without clobbering its outcome`, async () => {
      vi.useFakeTimers()
      try {
        const runs = fakeRuns()
        const runId = runs.seed(terminal)

        const loop = runAgentLoop({
          ...baseOpts(),
          runId,
          runState: runs.runState,
          startStream: runsUntilAborted(),
        })
        // Let the watchdog poll, see the run is no longer running, and abort.
        await vi.advanceTimersByTimeAsync(1000)
        await loop

        // The recorded terminal outcome survives — the loop did not rewrite it.
        expect(runs.statusOf(runId)).toBe(terminal)
        // A halt is reported as a user stop, not a failure.
        expect(errorBroadcasts()).toEqual(["Stopped by user"])
      } finally {
        vi.useRealTimers()
      }
    })
  }
})
