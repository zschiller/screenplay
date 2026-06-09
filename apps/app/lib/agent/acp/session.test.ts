import { describe, expect, it, vi } from "vitest"
import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  agentMessageChunk,
  blockText,
  isUpdate,
  textBlock,
  type Agent,
  type AnyMessage,
  type InitializeResponse,
  type LoadSessionRequest,
  type PromptRequest,
  type PromptResponse,
  type SessionUpdate,
  type StopReason,
  type Stream,
} from "./schema"
import {
  AcpSession,
  type AcpSessionPorts,
  type AcpTransport,
  type PlanDecision,
} from "./session"

/**
 * The generic ACP session module, exercised end-to-end against a **fake ACP
 * agent over an in-memory transport** — no live agent, no subprocess. The fake
 * is wired with the genuine upstream {@link AgentSideConnection}, so the session
 * speaks real ACP across a real (in-memory) `Stream`; only the transport's
 * backing and the agent's brain are fakes. This is the executable proof that
 * the transport seam admits an in-memory agent and that the handshake, prompt
 * round-trip, plan-mode pause, and `/stop` cancellation all map correctly.
 */

const SESSION_ID = "sess_fake_1"

/** What the fake agent does when it receives a `prompt` turn. */
type PromptBehavior = (ctx: {
  conn: AgentSideConnection
  params: PromptRequest
  /** Resolves when the client cancels the turn (a `/stop` / supersession). */
  whenCancelled: () => Promise<void>
}) => Promise<StopReason>

/**
 * A minimal ACP-conforming agent whose turn behavior is scripted per test. It
 * reaches back to the client via its {@link AgentSideConnection} to stream
 * `session/update`s and to raise permission requests, exactly as a real agent
 * would.
 */
interface FakeModes {
  availableModes: { id: string; name: string }[]
  currentModeId: string
}

class FakeAcpAgent implements Agent {
  initializeCalls = 0
  newSessionCalls = 0
  loadedSessionId: string | null = null
  cancelCalls = 0
  setSessionModeCalls: string[] = []
  private cancelled = false
  private cancelWaiters: Array<() => void> = []

  constructor(
    private readonly conn: AgentSideConnection,
    private readonly behavior: PromptBehavior,
    private readonly opts: { loadSession?: boolean; modes?: FakeModes } = {}
  ) {}

  async initialize(): Promise<InitializeResponse> {
    this.initializeCalls++
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: this.opts.loadSession ?? true },
    }
  }

  async newSession(): Promise<{ sessionId: string; modes?: FakeModes }> {
    this.newSessionCalls++
    return { sessionId: SESSION_ID, modes: this.opts.modes }
  }

  async authenticate(): Promise<void> {
    // The fake never demands auth, so `newSession` succeeds without it.
  }

  async loadSession(
    params: LoadSessionRequest
  ): Promise<{ modes?: FakeModes }> {
    this.loadedSessionId = params.sessionId
    return { modes: this.opts.modes }
  }

  async setSessionMode(params: { modeId: string }): Promise<void> {
    this.setSessionModeCalls.push(params.modeId)
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    this.cancelled = false
    const stopReason = await this.behavior({
      conn: this.conn,
      params,
      whenCancelled: () => this.whenCancelled(),
    })
    return { stopReason }
  }

  async cancel(): Promise<void> {
    this.cancelCalls++
    this.cancelled = true
    for (const wake of this.cancelWaiters.splice(0)) wake()
  }

  private whenCancelled(): Promise<void> {
    if (this.cancelled) return Promise.resolve()
    return new Promise((resolve) => this.cancelWaiters.push(resolve))
  }
}

/**
 * A pair of crossed in-memory streams — the whole transport, no bytes and no
 * process. The client writes flow to the agent's reader and vice versa, which
 * is all an {@link AcpTransport} (genuine ACP's `Stream`) is.
 */
function inMemoryStreams(): { client: Stream; agent: Stream } {
  const toAgent = new TransformStream<AnyMessage, AnyMessage>()
  const toClient = new TransformStream<AnyMessage, AnyMessage>()
  return {
    client: { writable: toAgent.writable, readable: toClient.readable },
    agent: { writable: toClient.writable, readable: toAgent.readable },
  }
}

/** Stand up a fake agent on one end and hand back the client-side transport. */
function connectFakeAgent(
  behavior: PromptBehavior,
  opts: { loadSession?: boolean; modes?: FakeModes } = {}
): { transport: AcpTransport; agent: FakeAcpAgent } {
  const { client, agent: agentStream } = inMemoryStreams()
  let agent!: FakeAcpAgent
  const agentConn = new AgentSideConnection(
    (conn) => (agent = new FakeAcpAgent(conn, behavior, opts)),
    agentStream
  )
  // `agent` holds `agentConn`, keeping its receive loop alive for the session.
  void agentConn
  return { transport: client, agent }
}

/** Collecting ports with a configurable plan-mode gate. */
function collectingPorts(
  gate: (
    req: Parameters<AcpSessionPorts["requestPlanApproval"]>[0]
  ) => Promise<PlanDecision> = async () => ({
    approved: true,
  })
) {
  const updates: SessionUpdate[] = []
  const permissionRequests: Parameters<
    AcpSessionPorts["requestPlanApproval"]
  >[0][] = []
  const ports: AcpSessionPorts = {
    onUpdate: (update) => void updates.push(update),
    requestPlanApproval: async (request) => {
      permissionRequests.push(request)
      return gate(request)
    },
  }
  return { ports, updates, permissionRequests }
}

/** The text of every `agent_message_chunk` update, in order. */
function chunkTexts(updates: SessionUpdate[]): string[] {
  return updates
    .filter((update) => isUpdate(update, "agent_message_chunk"))
    .map((update) => blockText(update.content))
}

/** A typical two-option permission request: approve or reject the tool call. */
function approveOrReject() {
  return {
    sessionId: SESSION_ID,
    options: [
      { optionId: "allow", name: "Approve", kind: "allow_once" as const },
      { optionId: "reject", name: "Reject", kind: "reject_once" as const },
    ],
    toolCall: { toolCallId: "call_1", title: "Run the plan" },
  }
}

describe("AcpSession — handshake and new-or-load", () => {
  it("performs the ACP handshake and creates a new session", async () => {
    const { transport, agent } = connectFakeAgent(async () => "end_turn")
    const { ports } = collectingPorts()

    const session = await AcpSession.open(transport, ports, { cwd: "/work" })

    expect(agent.initializeCalls).toBe(1)
    expect(agent.newSessionCalls).toBe(1)
    expect(session.id).toBe(SESSION_ID)
  })

  it("loads an existing session instead of creating one", async () => {
    const { transport, agent } = connectFakeAgent(async () => "end_turn")
    const { ports } = collectingPorts()

    const session = await AcpSession.open(transport, ports, {
      cwd: "/work",
      loadSessionId: "sess_prior",
    })

    expect(agent.loadedSessionId).toBe("sess_prior")
    expect(agent.newSessionCalls).toBe(0)
    expect(session.id).toBe("sess_prior")
  })
})

describe("AcpSession — prompt round-trip", () => {
  it("sends the turn as an ACP prompt and streams the resulting updates", async () => {
    const behavior: PromptBehavior = async ({ conn }) => {
      await conn.sessionUpdate({
        sessionId: SESSION_ID,
        update: agentMessageChunk("Hel"),
      })
      await conn.sessionUpdate({
        sessionId: SESSION_ID,
        update: agentMessageChunk("lo"),
      })
      return "end_turn"
    }
    const { transport } = connectFakeAgent(behavior)
    const { ports, updates } = collectingPorts()
    const session = await AcpSession.open(transport, ports, { cwd: "/work" })

    const stopReason = await session.prompt(
      [textBlock("hi")],
      new AbortController().signal
    )

    expect(stopReason).toBe("end_turn")
    expect(chunkTexts(updates)).toEqual(["Hel", "lo"])
  })
})

describe("AcpSession — plan-mode pause (the riskiest seam)", () => {
  it("maps a permission request to the plan-mode pause and resumes on approve", async () => {
    const behavior: PromptBehavior = async ({ conn }) => {
      const { outcome } = await conn.requestPermission(approveOrReject())
      const approved =
        outcome.outcome === "selected" && outcome.optionId === "allow"
      await conn.sessionUpdate({
        sessionId: SESSION_ID,
        update: agentMessageChunk(approved ? "ran the plan" : "stopped"),
      })
      return "end_turn"
    }
    const { transport } = connectFakeAgent(behavior)
    const { ports, updates, permissionRequests } = collectingPorts(
      async () => ({
        approved: true,
      })
    )
    const session = await AcpSession.open(transport, ports, { cwd: "/work" })

    const stopReason = await session.prompt(
      [textBlock("make a plan")],
      new AbortController().signal
    )

    // The permission request paused on screenplay's gate, carrying the tool call.
    expect(permissionRequests).toHaveLength(1)
    expect(permissionRequests[0]!.toolCall.toolCallId).toBe("call_1")
    // Approve resumed the turn: the agent ran the tool and finished normally.
    expect(stopReason).toBe("end_turn")
    expect(chunkTexts(updates)).toEqual(["ran the plan"])
  })

  it("prefers allow_once over allow_always on approve — never auto-accepts later edits", async () => {
    // The real ExitPlanMode gate offers both an `allow_always` (auto-accept all
    // edits) and an `allow_once` (approve just this plan). Approving must take
    // the `allow_once`, or the session silently flips into accepting every later
    // edit unprompted (spike #408).
    let selected: string | undefined
    const behavior: PromptBehavior = async ({ conn }) => {
      const { outcome } = await conn.requestPermission({
        sessionId: SESSION_ID,
        options: [
          {
            optionId: "acceptEdits",
            name: "Auto-accept",
            kind: "allow_always",
          },
          { optionId: "default", name: "Approve", kind: "allow_once" },
          { optionId: "plan", name: "Keep planning", kind: "reject_once" },
        ],
        toolCall: { toolCallId: "call_1", title: "Ready to code?" },
      })
      if (outcome.outcome === "selected") selected = outcome.optionId
      return "end_turn"
    }
    const { transport } = connectFakeAgent(behavior)
    const { ports } = collectingPorts(async () => ({ approved: true }))
    const session = await AcpSession.open(transport, ports, { cwd: "/work" })

    await session.prompt([textBlock("plan it")], new AbortController().signal)

    expect(selected).toBe("default")
  })

  it("revises on reject — the agent is told no and takes another path", async () => {
    const behavior: PromptBehavior = async ({ conn }) => {
      const { outcome } = await conn.requestPermission(approveOrReject())
      const rejected =
        outcome.outcome === "selected" && outcome.optionId === "reject"
      await conn.sessionUpdate({
        sessionId: SESSION_ID,
        update: agentMessageChunk(rejected ? "took another path" : "ran it"),
      })
      return "end_turn"
    }
    const { transport } = connectFakeAgent(behavior)
    const { ports, updates } = collectingPorts(async () => ({
      approved: false,
      feedback: "not that one",
    }))
    const session = await AcpSession.open(transport, ports, { cwd: "/work" })

    const stopReason = await session.prompt(
      [textBlock("do the risky thing")],
      new AbortController().signal
    )

    // Reject delivered a `reject_*` option; the agent revised rather than ran.
    expect(stopReason).toBe("end_turn")
    expect(chunkTexts(updates)).toEqual(["took another path"])
  })

  it("cancels an outstanding permission request when the turn is stopped", async () => {
    const controller = new AbortController()
    const behavior: PromptBehavior = async ({ conn }) => {
      const { outcome } = await conn.requestPermission(approveOrReject())
      // A cancelled permission must yield the `cancelled` outcome (spec), so the
      // agent winds the turn down rather than running the tool.
      return outcome.outcome === "cancelled" ? "cancelled" : "end_turn"
    }
    const { transport } = connectFakeAgent(behavior)
    // The gate never resolves until the run is cancelled out from under it.
    const { ports } = collectingPorts(
      () =>
        new Promise<PlanDecision>((resolve) => {
          controller.signal.addEventListener("abort", () =>
            resolve({ approved: true })
          )
        })
    )
    const session = await AcpSession.open(transport, ports, { cwd: "/work" })

    const turn = session.prompt([textBlock("go")], controller.signal)
    await vi.waitFor(() => expect(session).toBeDefined())
    controller.abort()

    expect(await turn).toBe("cancelled")
  })
})

describe("AcpSession — plan mode (session/set_mode)", () => {
  const planModes: FakeModes = {
    availableModes: [
      { id: "default", name: "Default" },
      { id: "plan", name: "Plan" },
    ],
    currentModeId: "default",
  }

  it("switches the agent into plan mode when the turn is a plan turn", async () => {
    const { transport, agent } = connectFakeAgent(async () => "end_turn", {
      modes: planModes,
    })
    const { ports } = collectingPorts()

    await AcpSession.open(transport, ports, { cwd: "/work", planMode: true })

    expect(agent.setSessionModeCalls).toEqual(["plan"])
  })

  it("leaves the mode alone for a non-plan turn", async () => {
    const { transport, agent } = connectFakeAgent(async () => "end_turn", {
      modes: planModes,
    })
    const { ports } = collectingPorts()

    await AcpSession.open(transport, ports, { cwd: "/work", planMode: false })

    expect(agent.setSessionModeCalls).toEqual([])
  })

  it("is a no-op when the agent advertises no modes, even on a plan turn", async () => {
    // A mode-less agent (no `modes` in `session/new`) must not be sent a
    // `set_mode` it can't honor — plan mode degrades silently.
    const { transport, agent } = connectFakeAgent(async () => "end_turn")
    const { ports } = collectingPorts()

    await AcpSession.open(transport, ports, { cwd: "/work", planMode: true })

    expect(agent.setSessionModeCalls).toEqual([])
  })
})

describe("AcpSession — /stop and supersession map to ACP cancellation", () => {
  it("cancels the in-flight turn so the agent reports cancelled", async () => {
    const controller = new AbortController()
    const behavior: PromptBehavior = async ({ conn, whenCancelled }) => {
      await conn.sessionUpdate({
        sessionId: SESSION_ID,
        update: agentMessageChunk("working"),
      })
      // Stand down only once the client cancels — a `/stop` or a supersession,
      // which reach this module identically as an aborted signal.
      await whenCancelled()
      return "cancelled"
    }
    const { transport, agent } = connectFakeAgent(behavior)
    const { ports, updates } = collectingPorts()
    const session = await AcpSession.open(transport, ports, { cwd: "/work" })

    const turn = session.prompt([textBlock("go")], controller.signal)
    await vi.waitFor(() => expect(updates).toHaveLength(1))
    controller.abort()

    expect(await turn).toBe("cancelled")
    expect(agent.cancelCalls).toBe(1)
  })

  it("a turn started already-stopped is cancelled, not silently run", async () => {
    const behavior: PromptBehavior = async ({ whenCancelled }) => {
      await whenCancelled()
      return "cancelled"
    }
    const { transport, agent } = connectFakeAgent(behavior)
    const { ports } = collectingPorts()
    const session = await AcpSession.open(transport, ports, { cwd: "/work" })

    const controller = new AbortController()
    controller.abort()
    const stopReason = await session.prompt(
      [textBlock("go")],
      controller.signal
    )

    expect(stopReason).toBe("cancelled")
    expect(agent.cancelCalls).toBe(1)
  })
})
