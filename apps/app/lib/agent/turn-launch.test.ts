import { describe, expect, it } from "vitest"
import type { Engine } from "./acp/engine-seam"
import type { RepoData } from "@/lib/types"
import {
  launchTurn,
  stopTurn,
  type PreparedTurn,
  type TurnLaunchDeps,
  type TurnStopDeps,
} from "./turn-launch"

const ENGINE = { run: async () => {} } as unknown as Engine

/** Turn Launch deps that record every side effect, in order, as one line each. */
function recordingDeps(
  opts: {
    engineFails?: boolean
    /** A plan still pending on the chat. */
    pendingPlan?: string
    /** Whether resolving a plan finds it still pending (default true). */
    planStillPending?: boolean
  } = {}
) {
  const log: string[] = []
  const afterResponse: Array<() => Promise<void>> = []
  const deps: TurnLaunchDeps = {
    async resolveEngine() {
      log.push("resolve engine")
      if (opts.engineFails) throw new Error("AGENT_ENGINE misconfigured")
      return ENGINE
    },
    async findPendingPlan() {
      return opts.pendingPlan ? { id: opts.pendingPlan } : null
    },
    async resolvePlan(planId, { approved, feedback }) {
      log.push(
        `resolve plan ${planId} ${approved ? "approved" : "rejected"}` +
          (feedback ? ` (${feedback})` : "")
      )
      return opts.planStillPending === false ? null : { runId: "run_0" }
    },
    async persistUserTurn(_chatId, userText) {
      log.push(`persist ${userText}`)
    },
    async startRun() {
      log.push("start run")
      return "run_1"
    },
    async broadcastStreamStart() {
      log.push("broadcast chat-stream-start")
    },
    async broadcastUpdate(_roomId, _chatId, update) {
      log.push(`broadcast ${update.sessionUpdate}`)
    },
    async broadcastControl(_roomId, _chatId, control) {
      log.push(
        control.kind === "plan_resolved"
          ? `broadcast plan_resolved ${control.approved ? "approved" : "rejected"}`
          : `broadcast ${control.kind}`
      )
    },
    async renameBranch(claim) {
      log.push(`rename git ${claim.from} -> ${claim.to}`)
    },
    async queueCommentRequest({ threadIds }) {
      log.push(`queue comments ${threadIds.join(",")}`)
    },
    async startCommentRequest() {
      log.push("start comments")
    },
    async settleCommentRequest({ runId }) {
      log.push(`settle comments ${runId}`)
    },
    async driveTurn(turn) {
      log.push(`drive ${turn.runId} planMode=${turn.planMode ?? false}`)
    },
    async loadRunStatus() {
      return "completed"
    },
    async wakeCoordinator({ runId, status }) {
      log.push(`wake coordinator ${runId} ${status}`)
    },
    runAfterResponse(task) {
      log.push("response sent")
      afterResponse.push(task)
    },
  }
  const flush = async () => {
    for (const task of afterResponse) await task()
  }
  return { deps, log, flush }
}

const request = { roomId: "room_1", chatId: "chat_1", message: "fix it" }

function target(log: string[], prepared: Partial<PreparedTurn> = {}) {
  return {
    async prepare(): Promise<PreparedTurn> {
      log.push("prepare target")
      return {
        systemPrompt: "sys",
        model: "anthropic:test",
        tools: {},
        userText: "fix it",
        ...prepared,
      }
    },
  }
}

describe("Turn Launch", () => {
  it("orders a sandbox turn: engine, target, persist, run, start marker, echo, then the git rename and the engine after the response", async () => {
    const { deps, log, flush } = recordingDeps()
    const result = await launchTurn(
      deps,
      request,
      target(log, {
        userText: "[branch: fix-it] fix it",
        planMode: true,
        branchRename: {
          branchId: "branch_1",
          sandboxName: "sb_1",
          userId: "user_1",
          repo: {} as RepoData,
          from: "quiet-otter",
          to: "fix-it",
          previousAutoNamed: true,
        },
        commentRequest: {
          sandboxName: "sb_1",
          userId: "user_1",
          threadIds: ["t1"],
        },
      })
    )
    expect(result).toEqual({ kind: "started", runId: "run_1" })
    await flush()

    expect(log).toEqual([
      "resolve engine",
      "prepare target",
      "persist [branch: fix-it] fix it",
      "start run",
      // The start marker opens the replay window, so the echo after it reaches
      // a client that joins mid-stream. Names are never broadcast: the target
      // wrote them to the room doc.
      "broadcast chat-stream-start",
      "broadcast user_message_chunk",
      "queue comments t1",
      "response sent",
      // The agent's first message names the new branch, so git is renamed
      // before the Engine runs.
      "rename git quiet-otter -> fix-it",
      "start comments",
      "drive run_1 planMode=true",
      "settle comments run_1",
    ])
  })

  it("starts and settles comments on a sandbox turn that queues none (an earlier plan-paused turn may still owe them)", async () => {
    const { deps, log, flush } = recordingDeps()
    await launchTurn(
      deps,
      request,
      target(log, {
        commentRequest: {
          sandboxName: "sb_1",
          userId: "user_1",
          threadIds: [],
        },
      })
    )
    await flush()

    expect(log).not.toContain("queue comments ")
    expect(log.slice(-3)).toEqual([
      "start comments",
      "drive run_1 planMode=false",
      "settle comments run_1",
    ])
  })

  it("a layer turn has no rename or comment request", async () => {
    const { deps, log, flush } = recordingDeps()
    await launchTurn(deps, request, target(log))
    await flush()

    expect(log).toEqual([
      "resolve engine",
      "prepare target",
      "persist fix it",
      "start run",
      "broadcast chat-stream-start",
      "broadcast user_message_chunk",
      "response sent",
      "drive run_1 planMode=false",
    ])
  })

  it("a missing target stops before any write", async () => {
    const { deps, log } = recordingDeps()
    const result = await launchTurn(deps, request, {
      prepare: async () => {
        log.push("prepare target")
        return null
      },
    })
    expect(result).toEqual({ kind: "target-not-found" })
    expect(log).toEqual(["resolve engine", "prepare target"])
  })

  it("an engine that fails to resolve fails before the target writes anything", async () => {
    const { deps, log } = recordingDeps({ engineFails: true })
    await expect(launchTurn(deps, request, target(log))).rejects.toThrow(
      "AGENT_ENGINE misconfigured"
    )
    expect(log).toEqual(["resolve engine"])
  })

  describe("resolving a plan", () => {
    it("a follow-up implicitly rejects the pending plan with the message as feedback, flipping the card inside the replay window", async () => {
      const { deps, log, flush } = recordingDeps({ pendingPlan: "plan_1" })
      await launchTurn(deps, request, target(log))
      await flush()

      expect(log).toEqual([
        "resolve engine",
        "prepare target",
        "resolve plan plan_1 rejected (fix it)",
        "persist fix it",
        "start run",
        "broadcast chat-stream-start",
        "broadcast plan_resolved rejected",
        "broadcast user_message_chunk",
        "response sent",
        "drive run_1 planMode=false",
      ])
    })

    it("a plan decision resolves that plan and resumes with its continuation", async () => {
      const { deps, log } = recordingDeps({ pendingPlan: "plan_other" })
      const result = await launchTurn(
        deps,
        {
          ...request,
          message: "Approved the plan. Proceed with the implementation.",
          planDecision: { planId: "plan_1", approved: true },
        },
        target(log, {
          userText: "Approved the plan. Proceed with the implementation.",
        })
      )

      expect(result).toEqual({ kind: "started", runId: "run_1" })
      expect(log.slice(0, 7)).toEqual([
        "resolve engine",
        "prepare target",
        "resolve plan plan_1 approved",
        "persist Approved the plan. Proceed with the implementation.",
        "start run",
        "broadcast chat-stream-start",
        "broadcast plan_resolved approved",
      ])
    })

    it("a decision on a plan that is no longer pending stops before any write", async () => {
      const { deps, log } = recordingDeps({ planStillPending: false })
      const result = await launchTurn(
        deps,
        {
          ...request,
          planDecision: { planId: "plan_1", approved: false, feedback: "no" },
        },
        target(log)
      )

      expect(result).toEqual({ kind: "plan-already-resolved" })
      expect(log).toEqual([
        "resolve engine",
        "prepare target",
        "resolve plan plan_1 rejected (no)",
      ])
    })

    it("a follow-up whose pending plan was resolved meanwhile runs without a card flip", async () => {
      const { deps, log } = recordingDeps({
        pendingPlan: "plan_1",
        planStillPending: false,
      })
      const result = await launchTurn(deps, request, target(log))

      expect(result).toEqual({ kind: "started", runId: "run_1" })
      expect(log).not.toContain("broadcast plan_resolved rejected")
    })
  })
})

/** Stop deps that record every side effect, in order, as one line each. */
function recordingStopDeps(activeRunId: string | null) {
  const log: string[] = []
  const deps: TurnStopDeps = {
    async findActiveRun() {
      return activeRunId ? { id: activeRunId } : null
    },
    async transition(runId, to) {
      log.push(`transition ${runId} ${to}`)
    },
    async broadcastControl(_roomId, _chatId, control) {
      log.push(`broadcast ${control.kind}`)
    },
    async broadcastStreamEnd() {
      log.push("broadcast chat-stream-end")
    },
  }
  return { deps, log }
}

describe("stopTurn (#909)", () => {
  it("records the stop, marks the transcript, then ends the stream", async () => {
    const { deps, log } = recordingStopDeps("run_1")
    await stopTurn(deps, { roomId: "room_1", chatId: "chat_1" })
    expect(log).toEqual([
      "transition run_1 aborted",
      "broadcast stopped",
      "broadcast chat-stream-end",
    ])
  })

  it("still ends the stream when no run is active", async () => {
    const { deps, log } = recordingStopDeps(null)
    await stopTurn(deps, { roomId: "room_1", chatId: "chat_1" })
    expect(log).toEqual(["broadcast chat-stream-end"])
  })
})
