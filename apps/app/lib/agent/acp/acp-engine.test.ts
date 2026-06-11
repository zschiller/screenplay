import { describe, expect, it, vi } from "vitest"

// `inProcessEngine` (imported for the capability contrast) binds to the model
// providers at import time; stub the resolution that would otherwise demand real
// API keys (mirrors contract.test.ts).
vi.mock("@/lib/agent/providers", () => ({
  resolveLanguageModel: () => ({}),
}))

import { ExternalEngine } from "./acp-engine"
import { inProcessEngine } from "./in-process-engine"
import type { EngineTurn, EngineUpdate } from "./engine-seam"
import { supportsUsageReporting } from "./engine-seam"
import type { AcpSession } from "./session"
import type { AcpSessionPorts, OpenSessionOptions } from "./session"
import type { AcpMessageRecord } from "./record"
import type { ContentBlock, RequestPermissionRequest } from "./schema"
import { blockText } from "./schema"

/**
 * Graceful capability degradation (ADR 0003 / ADR 0006, acceptance criterion 3):
 * a generic ACP agent may never surface prompt-cache usage, so the ACP engine
 * omits the {@link import("./engine-seam").UsageReportingEngine} capability
 * entirely. The `supports*` type guard narrows it out and the caller takes the
 * no-usage branch — never a half-implemented method on the core.
 */
describe("ExternalEngine — graceful capability degradation", () => {
  const engine = new ExternalEngine({
    sessionFactory: {
      open: async () => {
        throw new Error("session factory unused in this test")
      },
    },
  })

  it("identifies itself as the external engine", () => {
    expect(engine.id).toBe("external")
  })

  it("does not advertise usage reporting, so the type guard narrows it out", () => {
    expect(supportsUsageReporting(engine)).toBe(false)
  })

  it("contrasts with the in-process engine, which does report usage", () => {
    expect(supportsUsageReporting(inProcessEngine)).toBe(true)
  })

  it("a usage-reading caller takes the no-usage branch for the ACP engine", () => {
    // The exact shape every caller uses: narrow first, read only if narrowed.
    const usage = supportsUsageReporting(engine) ? engine.lastTurnUsage() : null
    expect(usage).toBeNull()
  })
})

/**
 * Permission-request routing — the bug that broke desktop ACP chat. A real ACP
 * adapter (`claude-code-acp`) raises a permission request for *every* tool
 * operation it wants to run — file edits, command execution — not just the
 * plan-mode approval gate. Only a plan-mode turn raises the gate (the agent's
 * ExitPlanMode request, surfaced only after `session/set_mode(plan)` — spike
 * #408). Treating an ordinary tool approval as the gate turned each edit into an
 * empty plan that paused-and-cancelled the turn: the in-flight tool call never
 * completed (its chip spun forever) and the agent looped — re-reading,
 * re-editing, re-asking — without end.
 */
describe("ExternalEngine — permission-request routing", () => {
  /** A turn skeleton; `planMode` is the axis these tests vary. */
  function turn(planMode: boolean): EngineTurn {
    return {
      chatId: "chat",
      runId: "run",
      roomId: "room",
      systemPrompt: "",
      model: "model",
      history: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      planMode,
    }
  }

  /** An ordinary tool approval a real adapter raises mid-turn (a file edit). */
  function editPermission(): RequestPermissionRequest {
    return {
      sessionId: "sess",
      toolCall: {
        toolCallId: "edit-1",
        title: "Edit src/app.ts",
        kind: "edit",
        status: "pending",
        rawInput: { file_path: "src/app.ts", content: "…" },
      },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "always", name: "Allow always", kind: "allow_always" },
        { optionId: "no", name: "Reject", kind: "reject_once" },
      ],
    }
  }

  /**
   * A fake session factory whose `prompt` runs `body(ports, signal)` — letting a
   * test stand in for the agent and drive `requestPlanApproval` exactly as the
   * real `AcpSession.resolvePermission` does on a `requestPermission` callback.
   */
  function factory(
    body: (ports: AcpSessionPorts, signal: AbortSignal) => Promise<unknown>
  ) {
    return {
      open: async (ports: AcpSessionPorts) =>
        ({
          id: "sess",
          prompt: (_blocks: unknown, signal: AbortSignal) =>
            body(ports, signal),
        }) as unknown as AcpSession,
    }
  }

  it("auto-allows ordinary tool permission requests outside plan mode", async () => {
    const updates: EngineUpdate[] = []
    let decision: { approved: boolean } | undefined
    const engine = new ExternalEngine({
      sessionFactory: factory(async (ports) => {
        decision = await ports.requestPlanApproval(editPermission())
        return "end_turn"
      }),
    })

    await engine.run(
      turn(false),
      (u) => void updates.push(u),
      new AbortController().signal
    )

    // The edit is approved so the tool runs to completion — never forwarded as
    // a plan gate, and the turn finishes normally rather than being cancelled.
    expect(decision).toEqual({ approved: true })
    expect(updates.some((u) => u.kind === "permission_request")).toBe(false)
    expect(updates.at(-1)).toEqual({ kind: "done", stopReason: "end_turn" })
  })

  it("forwards the plan-mode gate as a permission request and winds the turn down", async () => {
    const updates: EngineUpdate[] = []
    let decision: { approved: boolean } | undefined
    let turnAbortedByGate = false
    const engine = new ExternalEngine({
      sessionFactory: factory(async (ports, signal) => {
        decision = await ports.requestPlanApproval(editPermission())
        turnAbortedByGate = signal.aborted
        return "end_turn"
      }),
    })

    await engine.run(
      turn(true),
      (u) => void updates.push(u),
      new AbortController().signal
    )

    // In plan mode the request is the approval gate: it surfaces to the consumer
    // and the live ACP turn is wound down (the agent answers `cancelled`), so the
    // human resolves it later as a fresh run — no `done` for this turn.
    expect(updates.some((u) => u.kind === "permission_request")).toBe(true)
    expect(decision).toEqual({ approved: false })
    expect(turnAbortedByGate).toBe(true)
    expect(updates.some((u) => u.kind === "done")).toBe(false)
  })
})

/**
 * Native session resume — the durable fix for desktop chats whose model couldn't
 * see earlier messages. Each turn spawns a fresh adapter, so without resume the
 * agent boots a context-less `session/new` and only ever receives the latest
 * message. The engine instead loads the chat's stored ACP session when it has
 * one (so the agent carries its own prior context), and only replays the
 * transcript as text when it must open a fresh session — the first turn, or a
 * `session/load` miss.
 */
describe("ExternalEngine — native session resume", () => {
  /** A two-turn conversation: prior Q&A then the new user message. */
  const history: AcpMessageRecord[] = [
    { role: "user", content: [{ type: "text", text: "first question" }] },
    { role: "agent", content: [{ type: "text", text: "first answer" }] },
    { role: "user", content: [{ type: "text", text: "second question" }] },
  ]

  function turn(): EngineTurn {
    return {
      chatId: "chat",
      runId: "run",
      roomId: "room",
      systemPrompt: "",
      model: "model",
      history,
    }
  }

  /**
   * A factory that records every `open` and the blocks the turn prompts with. It
   * binds the loaded id on a `session/load`, or `newSessionId` on a fresh
   * `session/new`, and can be told to fail loads to exercise the miss fallback.
   */
  function recordingFactory(opts: { failLoad?: boolean } = {}) {
    const opens: OpenSessionOptions[] = []
    let prompted: ContentBlock[] | undefined
    const factory = {
      open: async (_ports: AcpSessionPorts, options: OpenSessionOptions) => {
        opens.push(options)
        if (options.loadSessionId && opts.failLoad) {
          throw new Error("unknown session")
        }
        return {
          id: options.loadSessionId ?? "new-sess",
          prompt: (blocks: ContentBlock[]) => {
            prompted = blocks
            return Promise.resolve("end_turn")
          },
        } as unknown as AcpSession
      },
    }
    return { factory, opens, prompted: () => prompted }
  }

  it("resumes a stored session and sends only the new message", async () => {
    const rec = recordingFactory()
    const persisted: string[] = []
    const engine = new ExternalEngine({
      sessionFactory: rec.factory,
      loadSessionId: "stored-sess",
      onSessionId: (id) => void persisted.push(id),
    })

    await engine.run(turn(), () => {}, new AbortController().signal)

    // Opened once, via session/load against the stored id.
    expect(rec.opens).toHaveLength(1)
    expect(rec.opens[0]?.loadSessionId).toBe("stored-sess")
    // A resumed session already holds the history, so only the new user message
    // is sent — no transcript replay.
    expect(rec.prompted()).toEqual([{ type: "text", text: "second question" }])
    // The id is unchanged, so nothing is re-persisted.
    expect(persisted).toEqual([])
  })

  it("opens a fresh session, persists its id, and replays history when none is stored", async () => {
    const rec = recordingFactory()
    const persisted: string[] = []
    const engine = new ExternalEngine({
      sessionFactory: rec.factory,
      onSessionId: (id) => void persisted.push(id),
    })

    await engine.run(turn(), () => {}, new AbortController().signal)

    expect(rec.opens).toHaveLength(1)
    expect(rec.opens[0]?.loadSessionId).toBeUndefined()
    // The freshly created id is persisted so the next turn resumes it.
    expect(persisted).toEqual(["new-sess"])
    // The fresh session has no context, so the whole conversation is replayed:
    // a transcript text block carrying the prior turns, then the new message.
    const blocks = rec.prompted() ?? []
    expect(blocks.at(-1)).toEqual({ type: "text", text: "second question" })
    const transcript = blockText(blocks[0]!)
    expect(transcript).toContain("first question")
    expect(transcript).toContain("first answer")
  })

  it("falls back to a fresh session and replays history when the load misses", async () => {
    const rec = recordingFactory({ failLoad: true })
    const persisted: string[] = []
    const engine = new ExternalEngine({
      sessionFactory: rec.factory,
      loadSessionId: "stale-sess",
      onSessionId: (id) => void persisted.push(id),
    })

    await engine.run(turn(), () => {}, new AbortController().signal)

    // Tried the stored id, missed, then opened a fresh session.
    expect(rec.opens).toHaveLength(2)
    expect(rec.opens[0]?.loadSessionId).toBe("stale-sess")
    expect(rec.opens[1]?.loadSessionId).toBeUndefined()
    expect(persisted).toEqual(["new-sess"])
    // The fresh fallback session replays the transcript so context survives.
    expect(blockText(rec.prompted()![0]!)).toContain("first answer")
  })
})
