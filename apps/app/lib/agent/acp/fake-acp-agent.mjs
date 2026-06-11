// A real, spawnable ACP agent that stands in for the user's installed CLI in
// tests (issue #414). It speaks genuine ACP JSON-RPC over its own stdio — the
// exact wire `SpawnAcpSessionFactory` drives a real subprocess across — but its
// "brain" is a pre-captured script (`AcpScript`, see `engine-contract.ts`)
// passed in via `FAKE_ACP_SCRIPT`, so the *same* Engine contract scenario the
// in-memory transport runs is replayed here over a real process boundary.
//
// Plain `.mjs` so `node` can run it directly with no TS loader: it imports only
// the compiled `@agentclientprotocol/sdk` package and inlines the
// one schema shape it needs (`planPermissionRequest`, kept byte-for-byte in
// sync with `schema.ts`). It never writes to stdout except ACP frames —
// diagnostics go to stderr — so the ndjson wire stays clean.
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@agentclientprotocol/sdk"
import { Readable, Writable } from "node:stream"

/** The captured script: what ACP to emit, the terminal stopReason, and whether to cancel. */
const script = JSON.parse(
  process.env.FAKE_ACP_SCRIPT ??
    '{"instructions":[],"stopReason":"end_turn","threw":false}'
)

/** Screenplay's plan-mode gate as an ACP permission request (mirrors `schema.ts`). */
function planPermissionRequest({ sessionId, toolCallId, plan }) {
  return {
    sessionId,
    toolCall: {
      toolCallId,
      title: "Review plan",
      kind: "other",
      status: "pending",
      content: [{ type: "content", content: { type: "text", text: plan } }],
      rawInput: { plan },
    },
    options: [
      { optionId: "approve", name: "Approve", kind: "allow_once" },
      { optionId: "reject", name: "Request changes", kind: "reject_once" },
    ],
  }
}

class ScriptedAgent {
  constructor(conn) {
    this.conn = conn
    this.cancelled = false
    this.resolveCancelled = () => {}
    this.whenCancelled = new Promise((resolve) => {
      this.resolveCancelled = resolve
    })
  }

  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
    }
  }

  async newSession() {
    return { sessionId: "sess_subprocess" }
  }

  async authenticate() {}

  async loadSession() {
    return {}
  }

  async setSessionMode() {
    return {}
  }

  async prompt({ sessionId }) {
    for (const instruction of script.instructions) {
      if (this.cancelled) break
      if (instruction.kind === "update") {
        await this.conn.sessionUpdate({ sessionId, update: instruction.update })
      } else if (instruction.kind === "permission") {
        const { outcome } = await this.conn.requestPermission(
          planPermissionRequest({
            sessionId,
            toolCallId: instruction.toolCallId,
            plan: instruction.plan,
          })
        )
        // A cancelled gate (the plan-pause winding the live turn down) makes the
        // agent stand down — exactly as a conforming agent does.
        if (outcome.outcome === "cancelled") this.cancelled = true
      }
    }
    if (this.cancelled) return { stopReason: "cancelled" }
    // The `/stop` scenario: the model stream threw, so a real agent has nothing
    // to report until the client cancels — then it resolves the turn cancelled.
    if (script.threw) {
      await this.whenCancelled
      return { stopReason: "cancelled" }
    }
    return { stopReason: script.stopReason ?? "end_turn" }
  }

  async cancel() {
    this.cancelled = true
    this.resolveCancelled()
  }
}

const transport = ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin)
)

// Holding the connection keeps the agent's receive loop alive until the parent
// kills the process (the factory's `dispose`).
const connection = new AgentSideConnection(
  (conn) => new ScriptedAgent(conn),
  transport
)
void connection
