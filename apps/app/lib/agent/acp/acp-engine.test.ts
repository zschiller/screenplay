import { describe, expect, it, vi } from "vitest"

// `inProcessEngine` (imported for the capability contrast) binds to the model
// providers at import time; stub the resolution that would otherwise demand real
// API keys (mirrors contract.test.ts).
vi.mock("@/lib/agent/providers", () => ({
  resolveLanguageModel: () => ({}),
}))

import { jsonSchema, tool } from "ai"
import { ExternalEngine } from "./acp-engine"
import { raiseHarnessGate } from "./harness-gate"
import { withPlanGate } from "../plan-gate"
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
 * adapter (`claude-agent-acp`) raises a permission request for *every* tool
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

  function turn(systemPrompt = ""): EngineTurn {
    return {
      chatId: "chat",
      runId: "run",
      roomId: "room",
      systemPrompt,
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

  // #903: a Coordinator resume must keep its tools, so the servers ride the
  // load, and the fresh fallback after a load miss, alike.
  it("hands its MCP servers and _meta to both the load and the fresh fallback", async () => {
    const rec = recordingFactory({ failLoad: true })
    const mcpServers = [
      {
        type: "http" as const,
        name: "screenplay",
        url: "http://127.0.0.1:1/api/agent/mcp",
        headers: [],
      },
    ]
    const sessionMeta = { claudeCode: { options: { allowedTools: ["x"] } } }
    const engine = new ExternalEngine({
      sessionFactory: rec.factory,
      loadSessionId: "stale-sess",
      mcpServers,
      sessionMeta,
    })

    await engine.run(turn(), () => {}, new AbortController().signal)

    expect(rec.opens).toHaveLength(2)
    for (const options of rec.opens) {
      expect(options.mcpServers).toBe(mcpServers)
      expect(options.sessionMeta).toBe(sessionMeta)
    }
  })

  /**
   * ACP has no system-prompt channel, so the external engine must fold the
   * turn's system prompt — the always-commit-and-push rule, plan-mode protocol,
   * skill index — into the prompt itself. Folding it on a *fresh* session is the
   * desktop equivalent of the in-process engine's `streamText` `system`; without
   * it the desktop agent ran with no screenplay instructions and never pushed.
   */
  it("leads a fresh session's prompt with the system prompt", async () => {
    const rec = recordingFactory()
    const engine = new ExternalEngine({ sessionFactory: rec.factory })

    await engine.run(
      turn("ALWAYS commit and push"),
      () => {},
      new AbortController().signal
    )

    // First block is the system prompt; the new user message still comes last.
    const blocks = rec.prompted() ?? []
    expect(blockText(blocks[0]!)).toBe("ALWAYS commit and push")
    expect(blocks.at(-1)).toEqual({ type: "text", text: "second question" })
  })

  /**
   * A resumed session already carries the instructions the creating turn sent,
   * so re-sending the system prompt every turn would only bloat its context. The
   * resumed path sends the new user message alone — no system-prompt block.
   */
  it("does not re-send the system prompt on a resumed session", async () => {
    const rec = recordingFactory()
    const engine = new ExternalEngine({
      sessionFactory: rec.factory,
      loadSessionId: "stored-sess",
    })

    await engine.run(
      turn("ALWAYS commit and push"),
      () => {},
      new AbortController().signal
    )

    expect(rec.prompted()).toEqual([{ type: "text", text: "second question" }])
  })
})

/**
 * Plan-gated Coordinator tools on a desktop harness (#903): the harness calls
 * `create_workspaces`, `open_pull_request` or `remove_workspace` over MCP, and
 * the MCP route hands the call to the running turn, which raises the same card
 * the built-in engine does and winds the turn down.
 */
describe("ExternalEngine — plan-gated tools over MCP", () => {
  const gatedTool = withPlanGate(
    tool({ inputSchema: jsonSchema({ type: "object" }) }),
    async () => ({ plan: "", input: { gate: "create_workspaces" } })
  )

  function turn(history: AcpMessageRecord[] = []): EngineTurn {
    return {
      chatId: "coord-chat",
      runId: "run",
      roomId: "room",
      systemPrompt: "",
      model: "model",
      history: [
        { role: "user", content: [{ type: "text", text: "try it 3 ways" }] },
        ...history,
      ],
      tools: { create_workspaces: gatedTool },
    }
  }

  function factory(
    body: (ports: AcpSessionPorts, signal: AbortSignal) => Promise<unknown>,
    prompted?: (blocks: ContentBlock[]) => void
  ) {
    return {
      open: async (ports: AcpSessionPorts) =>
        ({
          id: "sess",
          prompt: (blocks: ContentBlock[], signal: AbortSignal) => {
            prompted?.(blocks)
            return body(ports, signal)
          },
        }) as unknown as AcpSession,
    }
  }

  const call = {
    sessionUpdate: "tool_call",
    toolCallId: "toolu_1",
    title: "mcp__screenplay__create_workspaces",
    status: "pending",
  } as const

  it("raises the card on the harness's call and winds the turn down", async () => {
    const updates: EngineUpdate[] = []
    let raised: boolean | undefined
    let aborted = false
    const engine = new ExternalEngine({
      sessionFactory: factory(async (ports, signal) => {
        await ports.onUpdate(call)
        raised = await raiseHarnessGate("coord-chat", {
          toolName: "create_workspaces",
          plan: "- Variant A",
          input: { gate: "create_workspaces", workspaces: [] },
        })
        aborted = signal.aborted
        // What the harness sends once the call returns is past the card.
        await ports.onUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "toolu_1",
          status: "completed",
        })
        return "cancelled"
      }),
    })

    await engine.run(
      turn(),
      (u) => void updates.push(u),
      new AbortController().signal
    )

    expect(raised).toBe(true)
    expect(aborted).toBe(true)
    // The card, under the harness's own call id; the call's chip never shows.
    expect(updates).toHaveLength(1)
    const [update] = updates
    expect(update?.kind).toBe("permission_request")
    const request = (update as { request: RequestPermissionRequest }).request
    expect(request.toolCall.toolCallId).toBe("toolu_1")
    expect(request.toolCall.rawInput).toMatchObject({
      gate: "create_workspaces",
      plan: "- Variant A",
    })
    // Once the turn is over, a late call finds nothing to pause.
    expect(
      await raiseHarnessGate("coord-chat", {
        toolName: "create_workspaces",
        plan: "",
        input: { gate: "create_workspaces" },
      })
    ).toBe(false)
  })

  // A refusal completes with its reason (#1231); a failure fails.
  it.each([
    ["its gate refused", "completed", "No repo."],
    ["that failed", "failed", "GitHub is down."],
  ] as const)("shows a gated call %s", async (_, status, reason) => {
    const updates: EngineUpdate[] = []
    const engine = new ExternalEngine({
      sessionFactory: factory(async (ports) => {
        await ports.onUpdate(call)
        await ports.onUpdate({
          sessionUpdate: "tool_call_update",
          toolCallId: "toolu_1",
          status,
          content: [
            { type: "content", content: { type: "text", text: reason } },
          ],
        })
        return "end_turn"
      }),
    })

    await engine.run(
      turn(),
      (u) => void updates.push(u),
      new AbortController().signal
    )

    const shown = updates.filter((u) => u.kind === "session_update")
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "toolu_1",
        title: "mcp__screenplay__create_workspaces",
        status,
        content: [{ type: "content", content: { type: "text", text: reason } }],
      },
    })
  })

  it("leads the resumed turn with the outcome of the card the user decided", async () => {
    let prompted: ContentBlock[] = []
    const engine = new ExternalEngine({
      sessionFactory: factory(
        async () => "end_turn",
        (blocks) => (prompted = blocks)
      ),
      loadSessionId: "sess",
    })

    await engine.run(
      turn([
        {
          role: "user",
          content: [{ type: "text", text: "Approved the plan." }],
        },
        {
          role: "tool_call",
          toolCallId: "plan-1",
          title: "create_workspaces",
          status: "completed",
          content: [
            {
              type: "content",
              content: { type: "text", text: "Started 1 of 1 Workspace." },
            },
          ],
        },
      ]),
      () => {},
      new AbortController().signal
    )

    expect(prompted.map(blockText)).toEqual([
      "Approved the plan.",
      "create_workspaces result: Started 1 of 1 Workspace.",
    ])
  })
})
