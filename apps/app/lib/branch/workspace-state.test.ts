import { describe, expect, it } from "vitest"

import {
  roomWorkspaceFacts,
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
  chats?: BranchBusyChat[]
  plans?: Plan[]
  expected: Omit<WorkspaceState, "label">
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
    name: "needs you for a blocked merge",
    branch: ws({ prState: "open", prBlocked: true }),
    expected: {
      line: { kind: "idle", state: "needs-you", text: "Merge blocked" },
      section: "needs-you",
      needsYou: true,
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
]

describe("workspaceState", () => {
  it.each(CASES)("$name", ({ branch, chats = [], plans = [], expected }) => {
    expect(workspaceState(branch, roomWorkspaceFacts(chats, plans))).toEqual({
      label: "Sticky header",
      ...expected,
    })
  })

  it("labels a Workspace without a title New Workspace", () => {
    expect(
      workspaceState(ws({ title: " " }), roomWorkspaceFacts([], [])).label
    ).toBe("New Workspace")
  })
})
