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

- **Engine selection is a per-deployment env var.** Two implementations justify
  a selection mechanism; the surface (settled by the second-engine slice #383) is
  deliberately **minimal and explicit** — `AGENT_ENGINE=in-process|external` (default
  in-process), read at the engine boundary, **not** a per-Chat-Session schema
  column. A deployment runs entirely on one engine, so the choice never migrates
  data or branches per row, and an unrecognised value stays on the default rather
  than silently swapping. The default stays the in-process engine.

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

### Tool-call lifecycle + structured content (#377)

The renderer's data model is made ACP-faithful for tool calls, the next step the
"UI renders ACP for text" decision left for later slices. A tool call is now a
**single record keyed by `toolCallId`, updated in place** through ACP's
`pending → in_progress → completed/failed` lifecycle, rather than a static block
that only appears after completion:

- The in-process engine **translates** AI-SDK tool chunks to ACP:
  `tool-input-start → tool_call` (`pending`), `tool-call → tool_call_update`
  (`in_progress`), `tool-result/tool-error → tool_call_update`
  (`completed`/`failed`). The adapter maps each chunk; the contract test proves
  the engine drives the lifecycle.
- The consumer holds in-flight calls by id and **upserts the same durable record
  in place** (`upsertAcpToolCall`) on every update, so a crash mid-turn leaves
  the call's last known state on disk. The ACP update is broadcast verbatim, so
  clients update their own record in place too.
- A new `tool_call` record kind (`AcpToolCallRecord`) carries ACP's structured
  `ToolCallContent` — text, file `diff`, `terminal` — **as structure**; the
  renderer switches on block type rather than flattening to one `<pre>`. The
  old `create_pr`-only spinner generalizes to a status-aware indicator for every
  tool.

Still deferred: rebuilding tool-call records into `ModelMessage[]` tool context
for the in-process engine's next turn (the adapter's other direction), ACP
`agent_thought_chunk` (reasoning), and cutting the live routes over — the
tool-call signal still rides `runAgentLoop` in production until that move.

### Stop / supersession / error / crash-repair across the seam (#382)

The turn's failure and interruption semantics carry across the ACP seam so they
behave identically to the in-process loop, with durability preserved in
ACP-native form:

- **Stop / supersession → ACP cancellation.** The watchdog polling
  `RunState.isRunActive` and aborting the turn is part of the seam contract: the
  engine stands down when the run stops being live (a user `/stop` or a newer
  message superseding it) and reports the terminal outcome as a **stop**, never a
  `failed` run. The in-process engine reaches the consumer as `error: "Stopped by
user"` on abort; a real ACP agent that acknowledges `session/cancel` reaches it
  as `done` with `stopReason: "cancelled"`. The consumer treats **both** as a
  stop: it surfaces "Stopped by user" and closes, with no `completed`/`failed`
  transition — the run lifecycle already recorded `aborted`/`superseded`, so the
  consumer's transition no-ops on the already-terminal run.
- **Error → `failed`, distinct from a stop.** A genuine failure is surfaced in
  chat and records `failed`; the user-stop-vs-failure distinction is pinned by
  the consumer and contract tests.
- **Crash-repair in ACP-native form.** Because the consumer upserts each tool
  call in place by id, a crash mid-turn leaves the call frozen in a non-terminal
  status. `repairOrphanedAcpToolCalls` closes each orphan to `failed` with an
  interrupted marker on the next model-facing load (`loadAcpHistoryForModel`) —
  the ACP-native counterpart of `repairOrphanedToolCalls` for `ModelMessage[]`.
  It is pure and idempotent, and the repair invariant survives the ACP-native
  persistence round-trip, so a crashed turn's log loads back well-formed.

### ACP Engine behind the seam + engine selection (#383)

The second implementation lands, proving the seam is honest rather than nominal:

- **The ACP Engine** (`acp-engine.ts`) implements the seam by driving the
  `AcpSession` module (#381) — the way the in-process engine drives `streamText`
  — and passes the agent's genuine `session/update`s through to the same
  `AcpUpdateConsumer` **nearly natively** (no AI-SDK translation, because they are
  already ACP). The transport that reaches a real agent is an injected
  `AcpSessionFactory`, so production wraps a spawned agent's stdio while tests
  cross an in-memory stream to a fake agent — the engine never fixes the backing.
- **Plan-mode reconciliation.** screenplay's approval gate is *asynchronous* (the
  human resolves later via a fresh prompt), whereas ACP's permission request is an
  *in-turn* round-trip the agent blocks on. The engine forwards the request to the
  consumer (which pauses the run and ends the turn) and winds the live ACP turn
  down so the agent answers `cancelled`; the resume arrives as a new run, exactly
  like the in-process engine. `/stop`/supersession reach the engine as an aborted
  signal and surface as a stop, never a `failed` run.
- **Graceful capability degradation.** The ACP engine does **not** implement
  `UsageReportingEngine` — a generic ACP agent may never surface prompt-cache
  usage — so `supportsUsageReporting` narrows it out and the caller takes the
  no-usage branch (ADR 0003's pattern, exercised by a second engine for real).
- **The shared contract passes for BOTH engines.** `contractFor("acp", …)` drives
  the *same* scenario — a generic ACP agent scripted by the same `StreamDriver`,
  over a real in-memory ACP transport — to the same broadcasts, ACP-native
  records, and terminal run-state as the in-process engine. The plan-mode
  permission-request and `/stop` cancellation mappings are weighted heavily.
- **Still deferred (the genuinely separate "next move").** A production transport
  that spawns/connects to a real external ACP agent, and the live-route cutover
  retiring `runAgentLoop`/`AgentStreamEvent`/`ModelMessage` on `/api/agent/stream`
  and `/api/agent/plan`. The contract proves the swap target is compatible; this
  slice does not yet point the live routes at a running subprocess.

### The live-route cutover — the keystone (#397)

The single integrated cutover the PRD sequenced last: `/api/agent/stream` and
`/api/agent/plan` now drive `selectEngine → Engine.run → AcpUpdateConsumer`
through `driveEngineTurn` (which owns the abort watchdog at the boundary), and
the legacy machinery is **deleted**, not parallel.

- **Persistence is ACP-native on the live path.** The turn loads crash-repaired
  ACP-native history (`loadAcpHistoryForModel`) for engine input and appends the
  incoming user turn as an ACP-native `user` record; the consumer owns every
  subsequent append. No `ModelMessage` rows are written. `/api/agent/history`
  reads ACP-native records (merged with `submit_plan` pending rows for the plan
  card) and renders `user`/`agent`/`thought`/`tool_call` only — the
  `ModelMessage` conversion switch is gone, legacy rows reset (not migrated).
- **Broadcast is ACP-shaped on the live path.** Only `chat-acp-update` /
  `chat-acp-permission` carry ACP; the `AgentStreamEvent` / `chat-stream` channel
  is **retired**. The non-ACP control signals — the auto-naming renames, the plan
  resolution, and turn errors — ride a dedicated **control envelope**
  (`chat-control`), the way the permission request already rides its own; the
  stream start/end signals keep theirs. The synchronous user-echo that
  transitions the client into streaming is an ACP-native `user` record append
  plus a live `user_message_chunk` broadcast.
- **The plan gate is fully ACP-native.** The human resolution lands as an
  ACP-native `user` turn (`resolvePlanGate`) — approve → "proceed", reject → the
  feedback — which is both the continuation the engine rebuilds and the bubble
  the Room renders; the plan card flips via the control envelope. No synthetic
  `ModelMessage` tool-result is persisted anymore.
- **Deleted:** `runAgentLoop` + helpers and the duplicated cache-breakpoint
  helpers in `engine.ts` (the adapter is their sole home), `StreamBroadcaster`,
  the `AgentStreamEvent` type, and the `ModelMessage` persistence/repair
  functions (`appendMessage(s)`, `loadChatHistory(ForModel)`,
  `repairOrphanedToolCalls`). The **keystone** end-to-end live-route seam test
  pins the surviving path: ACP-native records (no `ModelMessage`), ACP-shaped
  broadcasts (no `chat-stream`), terminal run-state, the plan-pause and `/stop`
  mappings, and a reload that rebuilds the same conversation the live broadcast
  produced.

## Consequences

- The seam, the consumer, the AI-SDK ⟷ ACP adapter, the in-process engine, and
  the ACP-native persistence exist and are unit- + contract-tested. The
  contract test is the executable proof the seam is honest and the swap target
  will be compatible; the **text path**, the **plan-mode permission-request
  mapping**, and the **`/stop` stop-not-failure mapping** all pass today.
- This slice is intentionally **hybrid**: the text path _and_ the plan-mode
  permission-request mapping are modeled ACP-native at the seam (the consumer,
  the in-process engine's `submit_plan` → `permission_request` translation, the
  `resolvePlanGate` resolution, and the Message-Markers reconciliation, all
  unit-/contract-tested), while the _live_ `/api/agent/stream` and
  `/api/agent/plan` routes still drive the legacy `runAgentLoop` / `ModelMessage`
  machinery (the PRD sequences the route cutover into a later slice). The one
  user-visible behaviour landed on the live path here is **plan rejection
  feedback**, which was sent but never shown. Cutting the routes over to drive
  `InProcessEngine` through the consumer — and retiring `AgentStreamEvent`
  and the `ModelMessage` log — is the next move, now guarded by the
  contract/consumer/adapter/resolution tests landed here.
- `lib/agent/acp/` is the home of the seam; `CONTEXT.md`'s **Engine** entry is
  updated to "a seam speaking ACP, with a default in-process implementation and
  an external implementation," keeping the **Harness** distinction intact.
