import { beforeEach, describe, expect, it, vi } from "vitest"

// terminal-tabs.ts binds to the live Neon handle at import time. Drive the real
// store functions against a recording fake db + inspectable drizzle operators,
// so we can assert on the *data access* each call performs: which rows come
// back (and how they're mapped), what gets written, and — crucially — that
// every read/delete is scoped to the owning user so a collaborator's tabs can
// never leak or be deleted.

const { state } = vi.hoisted(() => ({
  state: {
    selectRows: [] as unknown[],
    insertReturn: [] as unknown[],
    calls: [] as Array<{
      op: "select" | "insert" | "delete"
      table: unknown
      where?: unknown
      order?: unknown
      values?: unknown
    }>,
  },
}))

// Inspectable stand-ins for the drizzle operators so the fake db's recorded
// `where`/`orderBy` are plain structures we can walk in assertions.
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({ type: "eq", col, val }),
  and: (...conds: unknown[]) => ({ type: "and", conds }),
  asc: (col: unknown) => ({ type: "asc", col }),
}))

vi.mock("@/lib/db", async () => {
  const schema =
    await vi.importActual<typeof import("./db/schema")>("./db/schema")
  const db = {
    select() {
      const b = {
        table: null as unknown,
        whereCond: null as unknown,
        orderCond: null as unknown,
        from(t: unknown) {
          b.table = t
          return b
        },
        where(c: unknown) {
          b.whereCond = c
          return b
        },
        orderBy(o: unknown) {
          b.orderCond = o
          return b
        },
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          state.calls.push({
            op: "select",
            table: b.table,
            where: b.whereCond,
            order: b.orderCond,
          })
          return Promise.resolve(state.selectRows).then(resolve, reject)
        },
      }
      return b
    },
    insert(t: unknown) {
      const b = {
        vals: null as unknown,
        values(v: unknown) {
          b.vals = v
          return b
        },
        returning() {
          state.calls.push({ op: "insert", table: t, values: b.vals })
          return Promise.resolve(state.insertReturn)
        },
      }
      return b
    },
    delete(t: unknown) {
      return {
        where(c: unknown) {
          state.calls.push({ op: "delete", table: t, where: c })
          return Promise.resolve(undefined)
        },
      }
    },
  }
  return { db, schema }
})

import { schema } from "./db"
import {
  deleteTerminalTab,
  insertTerminalTab,
  listTerminalTabs,
} from "./terminal-tabs"

type Cond = { type: string; conds?: Cond[]; col?: unknown; val?: unknown }

/** Find the eq() condition targeting `col` inside an and(...) structure. */
function eqFor(where: unknown, col: unknown): Cond | undefined {
  const root = where as Cond
  return root.conds?.find((c) => c.type === "eq" && c.col === col)
}

const NOW = new Date("2026-06-01T00:00:00Z")

beforeEach(() => {
  state.selectRows = []
  state.insertReturn = []
  state.calls = []
})

describe("listTerminalTabs", () => {
  it("returns rows mapped to records with createdAt as epoch millis", async () => {
    state.selectRows = [
      {
        id: "tab-1",
        userId: "user-1",
        roomId: "room-1",
        branch: "branch-1",
        label: "Terminal",
        createdAt: NOW,
      },
    ]
    const tabs = await listTerminalTabs({ userId: "user-1", roomId: "room-1" })
    expect(tabs).toEqual([
      {
        id: "tab-1",
        userId: "user-1",
        roomId: "room-1",
        branch: "branch-1",
        label: "Terminal",
        createdAt: NOW.getTime(),
      },
    ])
  })

  it("scopes the query to the user + room and orders oldest-first", async () => {
    await listTerminalTabs({ userId: "user-1", roomId: "room-1" })
    const call = state.calls.find((c) => c.op === "select")!
    expect(call.table).toBe(schema.terminalTab)
    expect(eqFor(call.where, schema.terminalTab.userId)?.val).toBe("user-1")
    expect(eqFor(call.where, schema.terminalTab.roomId)?.val).toBe("room-1")
    // No branch filter when branch is omitted.
    expect(eqFor(call.where, schema.terminalTab.branch)).toBeUndefined()
    expect(call.order).toEqual({
      type: "asc",
      col: schema.terminalTab.createdAt,
    })
  })

  it("adds a branch filter when scoped to a single branch", async () => {
    await listTerminalTabs({
      userId: "user-1",
      roomId: "room-1",
      branch: "branch-9",
    })
    const call = state.calls.find((c) => c.op === "select")!
    expect(eqFor(call.where, schema.terminalTab.branch)?.val).toBe("branch-9")
  })
})

describe("insertTerminalTab", () => {
  it("writes the provided fields and returns the mapped record", async () => {
    state.insertReturn = [
      {
        id: "tab-1",
        userId: "user-1",
        roomId: "room-1",
        branch: "branch-1",
        label: "Terminal",
        createdAt: NOW,
      },
    ]
    const record = await insertTerminalTab({
      id: "tab-1",
      userId: "user-1",
      roomId: "room-1",
      branch: "branch-1",
      label: "Terminal",
      createdAt: NOW,
    })
    expect(record.createdAt).toBe(NOW.getTime())
    const call = state.calls.find((c) => c.op === "insert")!
    expect(call.table).toBe(schema.terminalTab)
    expect(call.values).toMatchObject({
      id: "tab-1",
      userId: "user-1",
      roomId: "room-1",
      branch: "branch-1",
      label: "Terminal",
      createdAt: NOW,
    })
  })

  it("omits createdAt so the column default applies when not provided", async () => {
    state.insertReturn = [
      {
        id: "tab-2",
        userId: "user-1",
        roomId: "room-1",
        branch: "branch-1",
        label: "Terminal",
        createdAt: NOW,
      },
    ]
    await insertTerminalTab({
      id: "tab-2",
      userId: "user-1",
      roomId: "room-1",
      branch: "branch-1",
      label: "Terminal",
    })
    const call = state.calls.find((c) => c.op === "insert")!
    expect((call.values as Record<string, unknown>).createdAt).toBeUndefined()
  })
})

describe("deleteTerminalTab", () => {
  it("deletes by id scoped to the owning user", async () => {
    await deleteTerminalTab({ id: "tab-1", userId: "user-1" })
    const call = state.calls.find((c) => c.op === "delete")!
    expect(call.table).toBe(schema.terminalTab)
    expect(eqFor(call.where, schema.terminalTab.id)?.val).toBe("tab-1")
    expect(eqFor(call.where, schema.terminalTab.userId)?.val).toBe("user-1")
  })
})
