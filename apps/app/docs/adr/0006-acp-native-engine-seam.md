# 6. ACP-native Engine seam — speak ACP end-to-end (foundation + first text turn)

Date: 2026-06-08

Status: Accepted

## Context

The **Engine** (Agent Loop) _looked_ swappable — a single `runAgentLoop`
function — but wasn't, in the same way the Sandbox Provider wasn't before
ADR 0003. Worse, three different formats were welded along its path: the loop
was hardwired to the AI SDK's `streamText`; the browser consumed a bespoke
`AgentStreamEvent` wire format; and history was persisted as AI-SDK
`ModelMessage[]`. Even a working ACP engine would have had to translate into a
screenplay-only vocabulary the browser and database understood — adding
translators rather than removing them.

The PRD (#375) makes **ACP the lingua franca of the Chat Session, end-to-end**:
the engine boundary's vocabulary, the broadcast wire format, and the persisted
conversation all become ACP. #376 is the first end-to-end tracer bullet — the
simplest turn, a plain streamed text reply — plus the foundation the later
slices build on.

## Decision

- **Bind to the genuine ACP schema, not an approximation.** We vendor
  `@zed-industries/agent-client-protocol` and re-export its types and Zod
  schemas from a single surface (`lib/agent/acp/schema.ts`). The seam speaks
  real `session/update` shapes (`agent_message_chunk`, `tool_call`,
  `tool_call_update`, `plan`, …) and the real `PromptResponse.stopReason`. This
  binding is load-bearing: it is what makes the eventual swap to a real ACP
  client _subtractive_ rather than a refactor, and the contract test pins it.

- **Honest Engine seam (portable core + capability), modelled on ADR 0003.**
  `Engine` is the portable core every implementation can honor: `run(turn,
sink, signal)` drives one turn to completion, reporting `EngineUpdate`s — ACP
  `session/update` bodies plus the two terminal outcomes ACP expresses out of
  band (a `done` carrying `stopReason`, and `error`). Capabilities not every
  engine can honor sit behind a **`supports*`-style type guard**:
  `supportsUsageReporting(e): e is UsageReportingEngine` gates the prompt-cache
  `totalUsage` the in-process loop logs, exactly as `supportsHibernation` gates
  `snapshot()`. Rejected (per ADR 0003): optional methods on the core, and a
  capabilities bag.

- **The in-process AI-SDK engine becomes a translator (the default).** It keeps
  its `streamText` body but (a) rebuilds its `ModelMessage[]` input from
  ACP-native history and (b) emits ACP `agent_message_chunk` + a terminal
  `done` instead of driving `AgentStreamEvent`. The AI-SDK ⟷ ACP adapter owns
  both directions, **including the prompt-cache breakpoint placement**, because
  cache stability is a property of how the rebuilt request is shaped.

- **The ACP-update consumer is the deep module that maps ACP → app state.** One
  consumer turns the `session/update` stream into: the Y.Doc broadcast
  (ACP-shaped), the ACP-native message append (replacing `appendMessages` of
  `ModelMessage[]`), and the `RunState` terminal transitions + `chat-stream-end`
  signal. Its side effects are injected ports (like `RunStateRepo`), so the
  same scripted update stream provably yields the same broadcasts, ACP-native
  records, and run-state transitions in a unit test.

- **Multiplayer is preserved by brokering, not by ACP.** ACP is 1:1; screenplay
  is N browsers sharing one conversation. The resolution: **the server is the
  one ACP peer**, one session per run; **browsers are never ACP peers** — they
  render the server's broadcast. The Y.Doc fan-out is the multiplexer (single
  ACP session in → N browsers out); only the payload becomes ACP-shaped. This
  principle, not the format choice, is what keeps multiplayer working, and it is
  why "swap to a real ACP client" stays consistent: the swap replaces the
  _server-side_ engine, browsers still only receive broadcasts.

- **Persistence is ACP-native; existing history is reset.** The `agentMessage`
  payload moves from `ModelMessage` to an ACP-native `AcpMessageRecord` (genuine
  ACP `ContentBlock`s). Per the operator decision, old rows are **not**
  converted — new chats store ACP-native records going forward. The column
  unions both shapes during the transition (jsonb, so no SQL migration); the
  `role` text discriminates (`"agent"` for ACP, `"assistant"` for legacy
  AI-SDK). `agentChat` / `agentRun` / `agentPendingToolCall` are reused.

- **UI renders ACP for text.** The chat-store consumes a new `chat-acp-update`
  broadcast (`agent_message_chunk` deltas accumulate into the assistant
  message), the history route renders ACP-native records, and no browser opens
  an ACP connection. The renderer's data model becomes ACP-faithful as later
  slices add tool-call status, thoughts, and structured content.

- **Engine selection is deferred.** Two implementations justify a selection
  mechanism, but the exact surface (per-deployment env vs. per-Chat-Target) is
  the one decision left to the slice that lands the second engine. The default
  stays the in-process engine.

### Supersedes ADR 0002's byte-perfect replay rationale

ADR 0002 justified the owned Engine partly by "byte-perfect `ModelMessage[]`
replay." With ACP-native storage that specific justification no longer holds
verbatim: the durable log is ACP, and the in-process engine **rebuilds**
`ModelMessage[]` from it deterministically at turn time. The _spirit_ of
ADR 0002 — the Engine owns a durable, shared, replayable conversation and is
not a Harness — is preserved and becomes the **definition of the seam** both
implementations honor. A BYO CLI in a Terminal Tab still does not qualify; an
ACP agent does.

### Design goal: a clean, subtractive swap to a real ACP client

It must become _subtractive_ to drop the in-process engine and run every Chat
Session against a real ACP client. Three guardrails keep this real:

1. **Bind to genuine ACP schema** (above) — enforced by the contract test.
2. **Plan-mode mapping is the riskiest seam** — screenplay's approval gate maps
   onto ACP's _permission request_ (`planPermissionRequest` / the
   `permission_request` `EngineUpdate`), kept structurally distinct from ACP's
   informational `plan` update. The consumer turns that request into the
   `pauseForPlan` gate and the human resolution rides back through
   `resolvePlanGate` as an ACP-native record (approve → resume, reject → revise).
   It is weighted heavily in the contract test, which now passes for this
   mapping.
3. **Message Markers won't come entirely for free** — where ACP has a native
   slot, marker metadata rides it; where it doesn't, it stays an in-band
   screenplay convention, which is the one part a real ACP client won't emit.
   `lib/agent/acp/markers.ts` reconciles the two: `@`-mentions ride native
   `resource_link` blocks while plan/branch/skill markers stay in-band, and the
   conversion round-trips losslessly.

### Carried risk: prompt-cache stability

The in-process engine's cost profile depends on a stable cached prefix.
Rebuilding `ModelMessage[]` from ACP-native history is therefore a pure,
order-preserving map with no timestamps or ids, so identical history rebuilds
byte-identically and the Anthropic breakpoint keeps landing on a matching
prefix. The adapter test pins both the determinism and the
prefix-stable-when-a-turn-is-appended property.

## Consequences

- The seam, the consumer, the AI-SDK ⟷ ACP adapter, the in-process engine, and
  the ACP-native persistence exist and are unit- + contract-tested. The
  contract test is the executable proof the seam is honest and the swap target
  will be compatible; the **text path** and the **plan-mode permission-request
  mapping** pass today, with only `/stop` still `todo` in the skeleton.
- This slice is intentionally **hybrid**: the text path _and_ the plan-mode
  permission-request mapping are modeled ACP-native at the seam (the consumer,
  the in-process engine's `submit_plan` → `permission_request` translation, the
  `resolvePlanGate` resolution, and the Message-Markers reconciliation, all
  unit-/contract-tested), while the _live_ `/api/agent/stream` and
  `/api/agent/plan` routes still drive the legacy `runAgentLoop` / `ModelMessage`
  machinery (the PRD sequences the route cutover into a later slice). The one
  user-visible behaviour landed on the live path here is **plan rejection
  feedback**, which was sent but never shown. Cutting the routes over to drive
  `InProcessAiSdkEngine` through the consumer — and retiring `AgentStreamEvent`
  and the `ModelMessage` log — is the next move, now guarded by the
  contract/consumer/adapter/resolution tests landed here.
- `lib/agent/acp/` is the home of the seam; `CONTEXT.md`'s **Engine** entry is
  updated to "a seam speaking ACP, with a default in-process implementation and
  an ACP implementation," keeping the **Harness** distinction intact.
