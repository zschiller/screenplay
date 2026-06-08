import { isUpdate, textBlock, type SessionUpdate } from "./schema"
import type {
  ContentBlock,
  ToolCallContent,
  ToolCallStatus,
  ToolKind,
} from "./schema"

/**
 * The ACP-native durable conversation record — what we persist instead of the
 * AI-SDK `ModelMessage[]` (ADR 0006). One row per logical message; its content
 * is genuine ACP shapes.
 *
 * ACP itself streams *updates* and assumes the agent owns session state; here
 * the server's persisted log *is* that state, so a late joiner or a reload
 * rebuilds from these records.
 *
 * Four kinds exist: the two text roles (`user`/`agent`); `thought`, the agent's
 * reasoning — persisted so reload/replay keep it, but kept distinct from the
 * message body (it is *not* replayed into the model's input; see
 * {@link import("./adapter").acpHistoryToModelMessages}); and the **tool-call**
 * record (issue #377). A tool call is *not* append-only: it is created `pending`
 * and then mutated in place by id through its status lifecycle, so one durable
 * record tracks the whole call — see {@link applyToolCallUpdate}.
 *
 * `role` mirrors ACP's chunk vocabulary: `"agent"` (not `"assistant"`) is the
 * ACP term, `"thought"` is `agent_thought_chunk`, and `"tool_call"` matches
 * ACP's `sessionUpdate` discriminant.
 */
export type AcpMessageRecord =
  | { role: "user"; content: ContentBlock[] }
  | { role: "agent"; content: ContentBlock[] }
  | { role: "thought"; content: ContentBlock[] }
  | AcpToolCallRecord

/**
 * The durable form of an ACP tool call (issue #377). Keyed by `toolCallId`; the
 * consumer/renderer update the *same* record in place as `tool_call_update`s
 * arrive. `content` carries ACP's structured {@link ToolCallContent} blocks
 * (text, file `diff`, `terminal`) as *structure* — never flattened to a single
 * string — so the richer output survives to the screen.
 */
export interface AcpToolCallRecord {
  role: "tool_call"
  toolCallId: string
  title: string
  kind?: ToolKind
  status: ToolCallStatus
  content: ToolCallContent[]
  rawInput?: Record<string, unknown>
  rawOutput?: Record<string, unknown>
}

/**
 * Build the initial {@link AcpToolCallRecord} from a `tool_call` session
 * update. Defaults to `pending` and an empty content list when the agent
 * hasn't supplied them yet.
 */
export function toolCallRecord(update: SessionUpdate): AcpToolCallRecord {
  if (!isUpdate(update, "tool_call")) {
    throw new Error(`expected a tool_call update, got ${update.sessionUpdate}`)
  }
  return {
    role: "tool_call",
    toolCallId: update.toolCallId,
    title: update.title,
    kind: update.kind,
    status: update.status ?? "pending",
    content: update.content ?? [],
    rawInput: update.rawInput,
    rawOutput: update.rawOutput,
  }
}

/**
 * Merge a `tool_call` or `tool_call_update` onto the record held for its id,
 * returning a new record (pure — the caller swaps it in). Only the fields the
 * update carries change; ACP's update semantics *replace* the content and
 * locations collections wholesale, so a supplied `content` overwrites rather
 * than appends. An update for an id we've never seen seeds a fresh record
 * (lenient — a provider may skip the initial `tool_call`).
 */
export function applyToolCallUpdate(
  prev: AcpToolCallRecord | undefined,
  update: SessionUpdate
): AcpToolCallRecord {
  if (isUpdate(update, "tool_call")) {
    // A second `tool_call` for the same id is a re-seed; merge onto prior.
    const seeded = toolCallRecord(update)
    return prev ? { ...prev, ...seeded } : seeded
  }
  if (!isUpdate(update, "tool_call_update")) {
    throw new Error(
      `expected a tool_call(_update), got ${update.sessionUpdate}`
    )
  }
  const base: AcpToolCallRecord = prev ?? {
    role: "tool_call",
    toolCallId: update.toolCallId,
    title: update.title ?? update.toolCallId,
    status: "pending",
    content: [],
  }
  return {
    ...base,
    ...(update.title != null ? { title: update.title } : {}),
    ...(update.kind != null ? { kind: update.kind } : {}),
    ...(update.status != null ? { status: update.status } : {}),
    ...(update.content != null ? { content: update.content } : {}),
    ...(update.rawInput != null ? { rawInput: update.rawInput } : {}),
    ...(update.rawOutput != null ? { rawOutput: update.rawOutput } : {}),
  }
}

/**
 * The two terminal tool-call statuses: a call that reached one of these resolved
 * for good, so the crash-repair below leaves it alone. `pending`/`in_progress`
 * are the *non*-terminal states a crash can freeze a call in.
 */
const TERMINAL_TOOL_STATUSES: ReadonlySet<ToolCallStatus> =
  new Set<ToolCallStatus>(["completed", "failed"])

/** The interrupted-tool marker the repair appends to an orphaned call's content. */
const INTERRUPTED_CONTENT: ToolCallContent = {
  type: "content",
  content: textBlock("Tool execution was interrupted."),
}

/**
 * Repair the ACP-native log a crash mid-turn leaves behind (PRD #375, issue
 * #382), the ACP-native counterpart of {@link
 * import("../persistence").repairOrphanedToolCalls} for `ModelMessage[]`.
 *
 * The consumer upserts each tool call *in place* by id as its status advances
 * ({@link import("./consumer").AcpConsumerPorts.upsertToolCall}), so a crash
 * between a call going `in_progress` and its `completed`/`failed` update leaves
 * a durable record frozen in a **non-terminal** status — an orphan. Loading that
 * log for a follow-up turn (or rebuilding `ModelMessage[]` from it) would send
 * the model a tool call with no resolution, the malformed shape every provider
 * rejects.
 *
 * This closes each orphan to `failed` and appends an interrupted marker, so the
 * durability invariant holds across the round-trip: a crashed turn's log loads
 * back into a well-formed conversation. It is **pure and idempotent** — terminal
 * calls are untouched, so repairing an already-repaired (or already-clean) log
 * is a no-op and the marker is never appended twice. Like the AI-SDK repair, the
 * result is *not* persisted; repairing on every model-facing load keeps DB
 * timestamps clean and stays idempotent for whatever future bug also orphans a
 * call.
 */
export function repairOrphanedAcpToolCalls(
  records: AcpMessageRecord[]
): AcpMessageRecord[] {
  return records.map((record) => {
    if (record.role !== "tool_call") return record
    if (TERMINAL_TOOL_STATUSES.has(record.status)) return record
    return {
      ...record,
      status: "failed",
      content: [...record.content, INTERRUPTED_CONTENT],
    }
  })
}
