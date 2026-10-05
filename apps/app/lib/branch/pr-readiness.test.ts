import { describe, expect, it } from "vitest"

import type { AgentMessage } from "@/lib/agent/types"
import {
  CONNECT_GITHUB_FOR_PR_HINT,
  canRunPr,
  latestCreatedPr,
  prAvailability,
  prReadiness,
  type PrReadinessInput,
  type PrReadinessState,
} from "@/lib/branch/pr-readiness"
import type { RepoData } from "@/lib/types"

const ready: PrReadinessInput = {
  branch: { sandboxName: "sb-1", ref: "checkout-polish", status: "running" },
  pr: null,
  chatPr: null,
  availability: "ready",
  agentWorking: false,
  hasChanges: true,
  running: false,
}

const input = (over: Partial<PrReadinessInput> = {}): PrReadinessInput => ({
  ...ready,
  ...over,
  branch: { ...ready.branch, ...over.branch },
})

const openPr = { url: "https://github.com/a/b/pull/7", number: 7 }

// One row per condition the chat header and the Workspace menu used to judge
// apart (#1666); both now render whatever this returns.
const CASES: {
  name: string
  input: PrReadinessInput
  expected: PrReadinessState
}[] = [
  {
    name: "ready with changes",
    input: input(),
    expected: { existingPr: null, shown: true, blocker: null, running: false },
  },
  {
    name: "an open PR is linked, not offered again",
    input: input({ pr: { ...openPr, state: "open", blocked: true } }),
    expected: {
      existingPr: { ...openPr, state: "open", blocked: true },
      shown: false,
      blocker: null,
      running: false,
    },
  },
  {
    name: "a merged PR is linked until the Branch moves past it",
    input: input({ pr: { ...openPr, state: "merged" } }),
    expected: {
      existingPr: { ...openPr, state: "merged", blocked: undefined },
      shown: false,
      blocker: null,
      running: false,
    },
  },
  {
    name: "after the merge, the next PR is offered once there are changes",
    input: input({
      branch: { ...ready.branch, prMovedPast: 7 },
      pr: { ...openPr, state: "merged" },
    }),
    expected: { existingPr: null, shown: true, blocker: null, running: false },
  },
  {
    name: "after the merge, with no new changes yet, Create PR waits for them",
    input: input({
      branch: { ...ready.branch, prMovedPast: 7 },
      pr: { ...openPr, state: "merged" },
      hasChanges: false,
    }),
    expected: {
      existingPr: null,
      shown: true,
      blocker: { kind: "no-changes", reason: "No changes to propose yet." },
      running: false,
    },
  },
  {
    name: "moving past an earlier PR doesn't finish a later merged one",
    input: input({
      branch: { ...ready.branch, prMovedPast: 3 },
      pr: { ...openPr, state: "merged" },
    }),
    expected: {
      existingPr: { ...openPr, state: "merged", blocked: undefined },
      shown: false,
      blocker: null,
      running: false,
    },
  },
  {
    name: "a closed PR makes way for the next one",
    input: input({ pr: { ...openPr, state: "closed" } }),
    expected: { existingPr: null, shown: true, blocker: null, running: false },
  },
  {
    name: "a PR known only from a chat's create_pr result counts as open",
    input: input({ chatPr: openPr }),
    expected: {
      existingPr: { ...openPr, state: "open" },
      shown: false,
      blocker: null,
      running: false,
    },
  },
  {
    name: "a chat's newer PR wins over an older polled one",
    input: input({
      pr: { url: "https://github.com/a/b/pull/3", number: 3, state: "merged" },
      chatPr: openPr,
    }),
    expected: {
      existingPr: { ...openPr, state: "open" },
      shown: false,
      blocker: null,
      running: false,
    },
  },
  {
    name: "a chat's older create_pr result never hides a newer polled PR",
    input: input({
      pr: { url: "https://github.com/a/b/pull/9", number: 9, state: "open" },
      chatPr: openPr,
    }),
    expected: {
      existingPr: {
        url: "https://github.com/a/b/pull/9",
        number: 9,
        state: "open",
        blocked: undefined,
      },
      shown: false,
      blocker: null,
      running: false,
    },
  },
  {
    name: "a Done Workspace offers no create",
    input: input({ branch: { ...ready.branch, doneAt: 1 } }),
    expected: { existingPr: null, shown: false, blocker: null, running: false },
  },
  {
    name: "a repo that can't open a PR offers no create",
    input: input({ availability: "none" }),
    expected: { existingPr: null, shown: false, blocker: null, running: false },
  },
  {
    name: "no GitHub connection points at Settings",
    input: input({ availability: "connect" }),
    expected: {
      existingPr: null,
      shown: true,
      blocker: { kind: "connect-github", reason: CONNECT_GITHUB_FOR_PR_HINT },
      running: false,
    },
  },
  {
    name: "a starting Workspace waits",
    input: input({ branch: { ...ready.branch, status: "starting" } }),
    expected: {
      existingPr: null,
      shown: true,
      blocker: {
        kind: "starting",
        reason: "Still setting up the code…",
      },
      running: false,
    },
  },
  {
    name: "a failed setup blocks it",
    input: input({ branch: { ...ready.branch, status: "error" } }),
    expected: {
      existingPr: null,
      shown: true,
      blocker: {
        kind: "setup-failed",
        reason: "The chat’s setup failed.",
      },
      running: false,
    },
  },
  {
    name: "no branch ref blocks it",
    input: input({ branch: { ...ready.branch, ref: "" } }),
    expected: {
      existingPr: null,
      shown: true,
      blocker: { kind: "not-ready", reason: "The chat isn’t ready yet." },
      running: false,
    },
  },
  {
    name: "no sandbox blocks it",
    input: input({ branch: { ...ready.branch, sandboxName: "" } }),
    expected: {
      existingPr: null,
      shown: true,
      blocker: { kind: "not-ready", reason: "The chat isn’t ready yet." },
      running: false,
    },
  },
  {
    name: "any member's agent working blocks it",
    input: input({ agentWorking: true }),
    expected: {
      existingPr: null,
      shown: true,
      blocker: {
        kind: "agent-working",
        reason: "The agent is still working.",
      },
      running: false,
    },
  },
  {
    name: "nothing to propose blocks it",
    input: input({ hasChanges: false }),
    expected: {
      existingPr: null,
      shown: true,
      blocker: { kind: "no-changes", reason: "No changes to propose yet." },
      running: false,
    },
  },
  {
    name: "a running create has no blocker; the spinner says it",
    input: input({ running: true, agentWorking: true }),
    expected: { existingPr: null, shown: true, blocker: null, running: true },
  },
]

describe("prReadiness", () => {
  it.each(CASES)("$name", ({ input, expected }) => {
    expect(prReadiness(input)).toEqual(expected)
  })

  it("runs only when shown, unblocked and not already running", () => {
    for (const { input } of CASES) {
      const state = prReadiness(input)
      expect(canRunPr(state)).toBe(
        state.shown && !state.blocker && !state.running
      )
    }
    expect(canRunPr(prReadiness(input()))).toBe(true)
    expect(canRunPr(prReadiness(input({ running: true })))).toBe(false)
  })
})

describe("prAvailability", () => {
  const github = { repoOwner: "acme", repoName: "storefront" } as RepoData
  it("needs a GitHub remote and a known token", () => {
    expect(prAvailability(github, true)).toBe("ready")
    expect(prAvailability(github, false)).toBe("connect")
    expect(prAvailability(github, undefined)).toBe("none")
    expect(prAvailability({} as RepoData, true)).toBe("none")
  })
})

describe("latestCreatedPr", () => {
  const call = (text: string, status = "completed") =>
    ({
      role: "tool_call",
      title: "create_pr",
      status,
      content: [{ type: "content", content: { type: "text", text } }],
    }) as unknown as AgentMessage

  it("reads the newest completed create_pr result", () => {
    expect(
      latestCreatedPr([
        call("Opened #3 https://github.com/a/b/pull/3"),
        call("Opened #7 https://github.com/a/b/pull/7"),
        call("Opened #9 https://github.com/a/b/pull/9", "failed"),
      ])
    ).toEqual({ url: "https://github.com/a/b/pull/7", number: 7 })
    expect(latestCreatedPr([])).toBeNull()
  })
})
