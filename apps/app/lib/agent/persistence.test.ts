import { beforeEach, describe, expect, it, vi } from "vitest"

// `persistence.ts` binds to the live Drizzle handle at import time, which would
// demand a real DATABASE_URL. Swap it for a tiny in-memory stand-in for the
// `agent_message` table: a real (if minimal) implementation of the one
// operation under test — an insert that resolves a primary-key conflict by
// rewriting the existing row — so the suite asserts on the *rows* the writer
// leaves behind rather than on the SQL it emitted.
type Row = { id: string; chatId: string; role: string; message: unknown }

const rows = new Map<string, Row>()

function fakeDb() {
  return {
    insert() {
      return {
        values(row: Row) {
          return {
            onConflictDoUpdate({ set }: { set: { message: unknown } }) {
              const existing = rows.get(row.id)
              // An upsert on the primary key rewrites `message` and leaves the
              // row's identity (and its first-insert createdAt) alone.
              if (existing) existing.message = set.message
              else rows.set(row.id, { ...row })
              return Promise.resolve()
            },
          }
        },
      }
    },
  }
}

vi.mock("@/lib/db", () => ({ db: fakeDb() }))

import { upsertAcpToolCall } from "@/lib/agent/persistence"
import type { AcpToolCallRecord } from "@/lib/agent/acp/record"

function toolCall(
  toolCallId: string,
  title: string,
  status: AcpToolCallRecord["status"]
): AcpToolCallRecord {
  return { role: "tool_call", toolCallId, title, status, content: [] }
}

function titles(): string[] {
  return [...rows.values()].map((r) => (r.message as AcpToolCallRecord).title)
}

describe("upsertAcpToolCall", () => {
  beforeEach(() => rows.clear())

  // #742: providers that number tool calls per response (`call_1`, `call_2`, …
  // restarting each turn) reuse ids across turns. Keyed by chat alone, turn 2's
  // `call_1` overwrote turn 1's — history then showed the wrong tool calls,
  // stuck in the status the overwriting row happened to carry.
  it("keeps two runs' rows apart when a provider reuses tool-call ids", async () => {
    await upsertAcpToolCall(
      "chat_1",
      "run_1",
      toolCall("call_1", "read a", "completed")
    )
    await upsertAcpToolCall(
      "chat_1",
      "run_1",
      toolCall("call_2", "read b", "completed")
    )
    await upsertAcpToolCall(
      "chat_1",
      "run_2",
      toolCall("call_1", "grep c", "in_progress")
    )
    await upsertAcpToolCall(
      "chat_1",
      "run_2",
      toolCall("call_2", "grep d", "in_progress")
    )

    expect(rows.size).toBe(4)
    expect(titles()).toEqual(["read a", "read b", "grep c", "grep d"])
  })

  // The other half of the contract (ADR 0006, #377): within one run, a call's
  // status progression still rewrites the *same* row, so the call holds its
  // position in conversation order however many updates it receives.
  it("rewrites one row across a single call's status progression", async () => {
    await upsertAcpToolCall(
      "chat_1",
      "run_1",
      toolCall("call_1", "read a", "pending")
    )
    await upsertAcpToolCall(
      "chat_1",
      "run_1",
      toolCall("call_1", "read a", "in_progress")
    )
    await upsertAcpToolCall(
      "chat_1",
      "run_1",
      toolCall("call_1", "read a", "completed")
    )

    expect(rows.size).toBe(1)
    const [row] = [...rows.values()]
    expect((row.message as AcpToolCallRecord).status).toBe("completed")
  })

  it("keeps two chats' rows apart", async () => {
    await upsertAcpToolCall(
      "chat_1",
      "run_1",
      toolCall("call_1", "read a", "completed")
    )
    await upsertAcpToolCall(
      "chat_2",
      "run_1",
      toolCall("call_1", "read b", "completed")
    )

    expect(rows.size).toBe(2)
  })
})
