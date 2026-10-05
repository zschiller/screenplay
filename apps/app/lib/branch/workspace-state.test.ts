import { describe, expect, it } from "vitest"

import {
  agentCanStart,
  anyWorkspaceNeedsYou,
  formatElapsed,
  roomWorkspaceFacts,
  sketchChatStatusLine,
  workspaceBooting,
  workspaceSettingUp,
  workspaceState,
  type WorkspaceState,
  type WorkspaceStateBranch,
} from "@/lib/branch/workspace-state"
import type { BranchBusyChat } from "@/lib/branch-busy"
import type { PlanData } from "@/lib/types"

type Plan = Pick<PlanData, "branchId" | "status">

const ws = (overrides: Partial<WorkspaceStateBranch> = {}) => ({
  id: "ws",
  title: "Sticky header",
  status: "running" as const,
  ...overrides,
})
const streaming: BranchBusyChat = { branchId: "ws", isStreaming: true }

const CASES: {
  name: string
  branch: WorkspaceStateBranch
  chats?: (BranchBusyChat & { id?: string })[]
  plans?: Plan[]
  /** Chats, by id, whose transcript ends on an unanswered question. */
  questions?: string[]
  expected: Omit<WorkspaceState, "label" | "agentWorking">
}[] = [
  {
    name: "idle",
    branch: ws(),
    expected: {
      line: { kind: "idle", state: "ready", text: "Ready" },
      section: "idle",
      needsYou: false,
    },
  },
  {
    name: "idle with an open PR waiting on review",
    branch: ws({ prState: "open" }),
    expected: {
      line: { kind: "idle", state: "ready", text: "Ready" },
      section: "idle",
      needsYou: false,
    },
  },
  {
    name: "stopped",
    branch: ws({ status: "stopped" }),
    expected: {
      line: { kind: "idle", state: "stopped", text: "Stopped" },
      section: "idle",
      needsYou: false,
    },
  },
  {
    name: "working",
    branch: ws(),
    chats: [streaming],
    expected: {
      line: { kind: "idle", state: "working", text: "Agent working" },
      section: "working",
      needsYou: false,
    },
  },
  {
    name: "not working once the streaming chat is closed",
    branch: ws(),
    chats: [{ ...streaming, closedAt: 1 }],
    expected: {
      line: { kind: "idle", state: "ready", text: "Ready" },
      section: "idle",
      needsYou: false,
    },
  },
  {
    name: "not working when another Workspace's chat streams",
    branch: ws(),
    chats: [{ ...streaming, branchId: "other" }],
    expected: {
      line: { kind: "idle", state: "ready", text: "Ready" },
      section: "idle",
      needsYou: false,
    },
  },
  {
    name: "setting up",
    branch: ws({
      status: "starting",
      statusMessage: "Installing dependencies…",
    }),
    expected: {
      line: { kind: "progress", step: "Installing dependencies" },
      section: "working",
      needsYou: false,
    },
  },
  {
    name: "plan pending",
    branch: ws(),
    plans: [{ branchId: "ws", status: "pending" }],
    expected: {
      line: {
        kind: "idle",
        state: "needs-you",
        text: "Plan waiting for approval",
      },
      section: "needs-you",
      needsYou: true,
    },
  },
  {
    name: "plan approved no longer needs you",
    branch: ws(),
    plans: [{ branchId: "ws", status: "approved" }],
    expected: {
      line: { kind: "idle", state: "ready", text: "Ready" },
      section: "idle",
      needsYou: false,
    },
  },
  {
    name: "working wins over a pending plan",
    branch: ws(),
    chats: [streaming],
    plans: [{ branchId: "ws", status: "pending" }],
    expected: {
      line: { kind: "idle", state: "working", text: "Agent working" },
      section: "working",
      needsYou: false,
    },
  },
  {
    name: "needs you for a question waiting",
    branch: ws(),
    chats: [{ id: "c1", branchId: "ws" }],
    questions: ["c1"],
    expected: {
      line: { kind: "idle", state: "needs-you", text: "Question waiting" },
      section: "needs-you",
      needsYou: true,
    },
  },
  {
    name: "a question in a closed chat doesn't count",
    branch: ws(),
    chats: [{ id: "c1", branchId: "ws", closedAt: 1 }],
    questions: ["c1"],
    expected: {
      line: { kind: "idle", state: "ready", text: "Ready" },
      section: "idle",
      needsYou: false,
    },
  },
  {
    name: "a question in another Workspace's chat doesn't count",
    branch: ws(),
    chats: [{ id: "c2", branchId: "other" }],
    questions: ["c2"],
    expected: {
      line: { kind: "idle", state: "ready", text: "Ready" },
      section: "idle",
      needsYou: false,
    },
  },
  {
    name: "a pending plan wins over a question",
    branch: ws({ prState: "open", prBlocked: true }),
    chats: [{ id: "c1", branchId: "ws" }],
    plans: [{ branchId: "ws", status: "pending" }],
    questions: ["c1"],
    expected: {
      line: {
        kind: "idle",
        state: "needs-you",
        text: "Plan waiting for approval",
      },
      section: "needs-you",
      needsYou: true,
    },
  },
  {
    name: "a question wins over a blocked merge, even when stopped",
    branch: ws({ status: "stopped", prState: "open", prBlocked: true }),
    chats: [{ id: "c1", branchId: "ws" }],
    questions: ["c1"],
    expected: {
      line: { kind: "idle", state: "needs-you", text: "Question waiting" },
      section: "needs-you",
      needsYou: true,
    },
  },
  {
    name: "needs you for a blocked merge",
    branch: ws({ prState: "open", prBlocked: true }),
    expected: {
      line: { kind: "idle", state: "needs-you", text: "Merge blocked" },
      section: "needs-you",
      needsYou: true,
    },
  },
  {
    name: "needs you when its PR's events stopped waking the agent (#1703)",
    branch: ws({ prNumber: 7, prState: "merged", prWakesPaused: 7 }),
    expected: {
      line: { kind: "idle", state: "needs-you", text: "PR needs you" },
      section: "needs-you",
      needsYou: true,
    },
  },
  {
    name: "a newer PR than the paused one is ready again",
    branch: ws({ prNumber: 8, prState: "open", prWakesPaused: 7 }),
    expected: {
      line: { kind: "idle", state: "ready", text: "Ready" },
      section: "idle",
      needsYou: false,
    },
  },
  {
    name: "needs you when stopped with a plan pending",
    branch: ws({ status: "stopped" }),
    plans: [{ branchId: "ws", status: "pending" }],
    expected: {
      line: {
        kind: "idle",
        state: "needs-you",
        text: "Plan waiting for approval",
      },
      section: "needs-you",
      needsYou: true,
    },
  },
  {
    name: "needs you when setup failed",
    branch: ws({
      status: "error",
      statusMessage: "Installing dependencies…",
      error: "exit 1",
    }),
    expected: {
      line: {
        kind: "error",
        title: "Installing dependencies failed",
        detail: "exit 1",
      },
      section: "needs-you",
      needsYou: true,
    },
  },
  {
    name: "done",
    branch: ws({ doneAt: 1 }),
    expected: {
      line: { kind: "idle", state: "done", text: "Done" },
      section: "done",
      needsYou: false,
    },
  },
  {
    name: "done wins over a pending plan and a turn in flight",
    branch: ws({ doneAt: 1 }),
    chats: [streaming],
    plans: [{ branchId: "ws", status: "pending" }],
    expected: {
      line: { kind: "idle", state: "done", text: "Done" },
      section: "done",
      needsYou: false,
    },
  },
  {
    name: "setting up with no step on record",
    branch: ws({ status: "creating" }),
    expected: {
      line: { kind: "progress", step: "Setting up the code" },
      section: "working",
      needsYou: false,
    },
  },
  {
    name: "starting with an empty step",
    branch: ws({ status: "starting", statusMessage: "" }),
    expected: {
      line: { kind: "progress", step: "Starting" },
      section: "working",
      needsYou: false,
    },
  },
  {
    name: "plan rejected no longer needs you",
    branch: ws(),
    plans: [{ branchId: "ws", status: "rejected" }],
    expected: {
      line: { kind: "idle", state: "ready", text: "Ready" },
      section: "idle",
      needsYou: false,
    },
  },
  {
    name: "a blocked flag on a merged PR is ignored",
    branch: ws({ prState: "merged", prBlocked: true }),
    expected: {
      line: { kind: "idle", state: "ready", text: "Ready" },
      section: "idle",
      needsYou: false,
    },
  },
  {
    name: "needs you when a stopped Workspace's merge is blocked",
    branch: ws({ status: "stopped", prState: "open", prBlocked: true }),
    expected: {
      line: { kind: "idle", state: "needs-you", text: "Merge blocked" },
      section: "needs-you",
      needsYou: true,
    },
  },
  {
    name: "a failure titled from the three-dot step",
    branch: ws({
      status: "error",
      statusMessage: "Cloning repository...",
      error: "exit 128",
    }),
    expected: {
      line: {
        kind: "error",
        title: "Cloning repository failed",
        detail: "exit 128",
      },
      section: "needs-you",
      needsYou: true,
    },
  },
  {
    name: "a failure with no step or error on record",
    branch: ws({ status: "error" }),
    expected: {
      line: {
        kind: "error",
        title: "Setup failed",
        detail: "No details were recorded.",
      },
      section: "needs-you",
      needsYou: true,
    },
  },
  {
    name: "a stray error fails it even while the sandbox runs",
    branch: ws({ error: "boom" }),
    expected: {
      line: { kind: "error", title: "Setup failed", detail: "boom" },
      section: "needs-you",
      needsYou: true,
    },
  },
  {
    name: "done wins over a failed setup",
    branch: ws({ status: "error", error: "x", doneAt: 1 }),
    expected: {
      line: { kind: "idle", state: "done", text: "Done" },
      section: "done",
      needsYou: false,
    },
  },
]

describe("workspaceState", () => {
  it.each(CASES)(
    "$name",
    ({ branch, chats = [], plans = [], questions = [], expected }) => {
      expect(
        workspaceState(
          branch,
          roomWorkspaceFacts(chats, plans, new Set(questions))
        )
      ).toEqual({
        label: "Sticky header",
        agentWorking: chats.some(
          (c) => c.branchId === branch.id && c.isStreaming && !c.closedAt
        ),
        ...expected,
      })
    }
  )

  it("labels a Workspace without a title New chat", () => {
    expect(
      workspaceState(ws({ title: " " }), roomWorkspaceFacts([], [])).label
    ).toBe("New chat")
  })
})

describe("anyWorkspaceNeedsYou", () => {
  const room = roomWorkspaceFacts(
    [{ branchId: "busy", isStreaming: true }],
    [{ branchId: "plan", status: "pending" }]
  )
  const stateOf = (b: WorkspaceStateBranch) => workspaceState(b, room)

  it("is true when a Workspace needs you", () => {
    expect(
      anyWorkspaceNeedsYou([ws({ id: "a" }), ws({ id: "plan" })], stateOf)
    ).toBe(true)
    expect(
      anyWorkspaceNeedsYou(
        [ws({ id: "a" }), ws({ id: "b", status: "error" })],
        stateOf
      )
    ).toBe(true)
  })

  it("leaves Done Workspaces out", () => {
    expect(anyWorkspaceNeedsYou([ws({ id: "plan", doneAt: 1 })], stateOf)).toBe(
      false
    )
  })

  it("is false when every Workspace is working or idle, or there are none", () => {
    expect(
      anyWorkspaceNeedsYou([ws({ id: "a" }), ws({ id: "busy" })], stateOf)
    ).toBe(false)
    expect(anyWorkspaceNeedsYou([], stateOf)).toBe(false)
  })
})

describe("workspaceSettingUp", () => {
  it("is true while the Workspace is creating or starting", () => {
    expect(workspaceSettingUp(ws({ status: "creating" }))).toBe(true)
    expect(workspaceSettingUp(ws({ status: "starting" }))).toBe(true)
  })

  it("is false once it runs, stops, fails or is Done", () => {
    expect(workspaceSettingUp(ws())).toBe(false)
    expect(workspaceSettingUp(ws({ status: "stopped" }))).toBe(false)
    expect(workspaceSettingUp(ws({ status: "error" }))).toBe(false)
    expect(
      workspaceSettingUp(ws({ status: "starting", error: "Install failed" }))
    ).toBe(false)
    expect(
      workspaceSettingUp(ws({ status: "creating", doneAt: Date.now() }))
    ).toBe(false)
  })
})

describe("agentCanStart and workspaceBooting", () => {
  it("lets the agent start once the code is checked out, before setup ends", () => {
    const ready = { ...ws({ status: "creating" }), codeReady: true }
    expect(agentCanStart(ready)).toBe(true)
    expect(workspaceBooting(ready)).toBe(false)
    // Its status line still names the setup step.
    expect(workspaceSettingUp(ready)).toBe(true)
  })

  it("holds the agent while the code isn’t there yet or the sandbox is starting", () => {
    for (const branch of [
      ws({ status: "creating" }),
      ws({ status: "starting" }),
      { ...ws({ status: "starting" }), codeReady: true },
    ]) {
      expect(agentCanStart(branch)).toBe(false)
      expect(workspaceBooting(branch)).toBe(true)
    }
  })

  it("lets a running Workspace start, and isn’t booting once stopped or failed", () => {
    expect(agentCanStart(ws())).toBe(true)
    for (const status of ["stopped", "error"] as const) {
      expect(agentCanStart(ws({ status }))).toBe(false)
      expect(workspaceBooting(ws({ status }))).toBe(false)
    }
  })
})

describe("formatElapsed", () => {
  it("formats seconds and minutes", () => {
    expect(formatElapsed(0)).toBe("0s")
    expect(formatElapsed(40_900)).toBe("40s")
    expect(formatElapsed(125_000)).toBe("2m 05s")
  })
})

describe("sketchChatStatusLine", () => {
  const chat = { id: "s1" }
  it("is working while its turn is in flight", () => {
    expect(sketchChatStatusLine({ ...chat, isStreaming: true })).toEqual({
      kind: "idle",
      state: "working",
      text: "Agent working",
    })
  })
  it("needs you while its question waits", () => {
    expect(sketchChatStatusLine(chat, new Set(["s1"]))).toEqual({
      kind: "idle",
      state: "needs-you",
      text: "Question waiting",
    })
  })
  it("is ready otherwise, and once closed", () => {
    expect(sketchChatStatusLine(chat)).toMatchObject({ state: "ready" })
    expect(
      sketchChatStatusLine({ ...chat, closedAt: 1 }, new Set(["s1"]))
    ).toMatchObject({ state: "ready" })
  })
})
