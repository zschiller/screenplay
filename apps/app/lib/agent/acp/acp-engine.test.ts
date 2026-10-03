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
          close: () => {},
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

  // Codex asks before an MCP tool its annotations mark destructive or open
  // world (`remove_workspace`, `open_pull_request`). A Coordinator turn is
  // never in plan mode, so the ask is allowed and the user sees no prompt
  // (#1217).
  it.each(["remove_workspace", "open_pull_request"])(
    "allows Codex's ask to run the Coordinator's %s, with no prompt",
    async (tool) => {
      const updates: EngineUpdate[] = []
      let decision: { approved: boolean } | undefined
      const engine = new ExternalEngine({
        sessionFactory: factory(async (ports) => {
          decision = await ports.requestPlanApproval({
            sessionId: "sess",
            toolCall: {
              toolCallId: "mcp-1",
              title: `mcp__screenplay__${tool}`,
              status: "pending",
              rawInput: { workspace_id: "ws-1" },
            },
            options: [
              { optionId: "allow", name: "Allow", kind: "allow_once" },
              { optionId: "no", name: "Cancel", kind: "reject_once" },
            ],
          })
          return "end_turn"
        }),
      })

      await engine.run(
        turn(false),
        (u) => void updates.push(u),
        new AbortController().signal
      )

      expect(decision).toEqual({ approved: true })
      expect(updates.some((u) => u.kind === "permission_request")).toBe(false)
    }
  )

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
 * Codex plans through its `collaboration_mode` option, not a plan mode (#1337).
 * Its plan turn may ask for ordinary tool approvals, which run as on any turn;
 * the gate is its request to carry out the finished plan, raised to the
 * consumer as screenplay's own "Review plan" request. The plan it also sends as
 * its last reply is left to the gate, so it isn't shown twice.
 */
describe("ExternalEngine — Codex plan turn (#1337)", () => {
  const PLAN = "## Plan\n\n1. Edit the button\n2. Run the tests"

  function planTurn(): EngineTurn {
    return {
      chatId: "chat",
      runId: "run-7",
      roomId: "room",
      systemPrompt: "",
      model: "model",
      history: [{ role: "user", content: [{ type: "text", text: "go" }] }],
      planMode: true,
    }
  }

  /** A session on an agent that plans through its collaboration mode. */
  function codexFactory(
    body: (ports: AcpSessionPorts, signal: AbortSignal) => Promise<unknown>
  ) {
    return {
      open: async (ports: AcpSessionPorts) =>
        ({
          id: "sess",
          plansByCollaborationMode: true,
          prompt: (_blocks: unknown, signal: AbortSignal) =>
            body(ports, signal),
          close: () => {},
        }) as unknown as AcpSession,
    }
  }

  function reply(messageId: string, text: string) {
    return {
      sessionUpdate: "agent_message_chunk" as const,
      messageId,
      content: { type: "text" as const, text },
    }
  }

  /** Codex's request to carry out its finished plan. */
  function implementPlan(): RequestPermissionRequest {
    return {
      sessionId: "sess",
      toolCall: {
        toolCallId: "plan-review:plan-1",
        title: "Implement this plan?",
        kind: "switch_mode",
        status: "pending",
        rawInput: { plan: PLAN },
      },
      options: [
        { optionId: "implement", name: "Yes", kind: "allow_once" },
        { optionId: "revise", name: "No", kind: "reject_once" },
      ],
    }
  }

  function commandPermission(): RequestPermissionRequest {
    return {
      sessionId: "sess",
      toolCall: {
        toolCallId: "cmd-1",
        title: "ls",
        kind: "execute",
        status: "pending",
        rawInput: { command: ["ls"] },
      },
      options: [
        { optionId: "allow", name: "Allow", kind: "allow_once" },
        { optionId: "no", name: "Reject", kind: "reject_once" },
      ],
    }
  }

  function sentTexts(updates: EngineUpdate[]): string[] {
    return updates.flatMap((u) =>
      u.kind === "session_update" &&
      u.update.sessionUpdate === "agent_message_chunk"
        ? [blockText(u.update.content)]
        : []
    )
  }

  it("auto-allows an ordinary tool approval on a Codex plan turn", async () => {
    const updates: EngineUpdate[] = []
    let decision: { approved: boolean } | undefined
    const engine = new ExternalEngine({
      sessionFactory: codexFactory(async (ports) => {
        decision = await ports.requestPlanApproval(commandPermission())
        return "end_turn"
      }),
    })

    await engine.run(
      planTurn(),
      (u) => void updates.push(u),
      new AbortController().signal
    )

    expect(decision).toEqual({ approved: true })
    expect(updates.some((u) => u.kind === "permission_request")).toBe(false)
    expect(updates.at(-1)).toEqual({ kind: "done", stopReason: "end_turn" })
  })

  it("ends on the plan approval, showing the plan once", async () => {
    const updates: EngineUpdate[] = []
    let decision: { approved: boolean } | undefined
    let turnAbortedByGate = false
    const engine = new ExternalEngine({
      sessionFactory: codexFactory(async (ports, signal) => {
        await ports.onUpdate(reply("msg-1", "Let me look "))
        await ports.onUpdate(reply("msg-1", "around."))
        await ports.onUpdate({
          sessionUpdate: "tool_call",
          toolCallId: "read-1",
          title: "Read button.tsx",
          status: "completed",
        })
        await ports.onUpdate(reply("plan-1", PLAN))
        // Codex reports usage and goes idle before it asks.
        await ports.onUpdate({
          sessionUpdate: "usage_update",
          used: 1200,
          size: 200000,
        })
        await ports.onUpdate({
          sessionUpdate: "session_info_update",
          _meta: { codex: { threadStatus: { type: "idle" } } },
        })
        decision = await ports.requestPlanApproval(implementPlan())
        turnAbortedByGate = signal.aborted
        return "cancelled"
      }),
    })

    await engine.run(
      planTurn(),
      (u) => void updates.push(u),
      new AbortController().signal
    )

    expect(sentTexts(updates)).toEqual(["Let me look ", "around."])
    expect(
      updates.flatMap((u) =>
        u.kind === "session_update" ? [u.update.sessionUpdate] : []
      )
    ).toEqual([
      "agent_message_chunk",
      "agent_message_chunk",
      "tool_call",
      "usage_update",
      "session_info_update",
    ])
    const gate = updates.find((u) => u.kind === "permission_request")
    expect(gate).toBeDefined()
    if (gate?.kind !== "permission_request") return
    expect(gate.request.toolCall).toMatchObject({
      toolCallId: "run-7:plan-review:plan-1",
      title: "Review plan",
      rawInput: { plan: PLAN },
    })
    expect(gate.request.options.map((o) => o.kind)).toEqual([
      "allow_once",
      "reject_once",
    ])
    expect(updates.at(-1)).toBe(gate)
    expect(decision).toEqual({ approved: false })
    expect(turnAbortedByGate).toBe(true)
    expect(updates.some((u) => u.kind === "done")).toBe(false)
  })

  it("sends a last reply that isn't the plan before the gate", async () => {
    const updates: EngineUpdate[] = []
    const engine = new ExternalEngine({
      sessionFactory: codexFactory(async (ports) => {
        await ports.onUpdate(reply("msg-1", "Here is what I found."))
        await ports.requestPlanApproval(implementPlan())
        return "cancelled"
      }),
    })

    await engine.run(
      planTurn(),
      (u) => void updates.push(u),
      new AbortController().signal
    )

    expect(sentTexts(updates)).toEqual(["Here is what I found."])
    expect(updates.at(-1)?.kind).toBe("permission_request")
  })

  it("sends a turn's last reply when it ends without a plan", async () => {
    const updates: EngineUpdate[] = []
    const engine = new ExternalEngine({
      sessionFactory: codexFactory(async (ports) => {
        await ports.onUpdate(reply("msg-1", "Which page do you mean?"))
        return "end_turn"
      }),
    })

    await engine.run(
      planTurn(),
      (u) => void updates.push(u),
      new AbortController().signal
    )

    expect(sentTexts(updates)).toEqual(["Which page do you mean?"])
    expect(updates.at(-1)).toEqual({ kind: "done", stopReason: "end_turn" })
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
          close: () => {},
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

  // #1524: the context folder is written before the session opens, so the
  // agent reads current files, and rides the load and the fallback alike.
  it("writes its context folder before the session opens and hands it to every open", async () => {
    const rec = recordingFactory({ failLoad: true })
    const order: string[] = []
    const engine = new ExternalEngine({
      sessionFactory: {
        open: (ports, options) => {
          order.push("open")
          return rec.factory.open(ports, options)
        },
      },
      loadSessionId: "stale-sess",
      additionalDirectories: ["/data/agent-context/chat-1"],
      prepareContext: async () => void order.push("context"),
    })

    await engine.run(turn(), () => {}, new AbortController().signal)

    expect(order).toEqual(["context", "open", "open"])
    for (const options of rec.opens) {
      expect(options.additionalDirectories).toEqual([
        "/data/agent-context/chat-1",
      ])
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

  /**
   * A Skill saved since the session's first turn isn't in the prompt it holds
   * (#1555), so a resumed turn leads with the turn's Skill index; a fresh one
   * has it in the system prompt already.
   */
  it("leads a resumed turn with its Skill index", async () => {
    const rec = recordingFactory()
    const engine = new ExternalEngine({
      sessionFactory: rec.factory,
      loadSessionId: "stored-sess",
    })

    await engine.run(
      { ...turn("ALWAYS commit and push"), skillsNote: "[Skills: review]" },
      () => {},
      new AbortController().signal
    )

    expect(rec.prompted()).toEqual([
      { type: "text", text: "[Skills: review]" },
      { type: "text", text: "second question" },
    ])
  })

  it("doesn't add the Skill index to a fresh session's prompt", async () => {
    const rec = recordingFactory()
    const engine = new ExternalEngine({ sessionFactory: rec.factory })

    await engine.run(
      { ...turn("SYSTEM"), skillsNote: "[Skills: review]" },
      () => {},
      new AbortController().signal
    )

    const texts = (rec.prompted() ?? []).map((b) => blockText(b))
    expect(texts[0]).toBe("SYSTEM")
    expect(texts.join("\n")).not.toContain("[Skills: review]")
  })
})
