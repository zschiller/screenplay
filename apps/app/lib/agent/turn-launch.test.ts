import { describe, expect, it } from "vitest"
import type { Engine } from "./acp/engine-seam"
import type { RunStatus } from "./run-state"
import type { Steer } from "./steer-inbox"
import type { RepoData } from "@/lib/types"
import type { SessionUpdate } from "./acp/schema"
import { echoedUserTurn } from "./user-turn"
import {
  launchTurn,
  stopTurn,
  type PreparedTurn,
  type TurnLaunchDeps,
  type TurnStopDeps,
} from "./turn-launch"

const ENGINE: Engine = { id: "scripted", async run() {} }

/** Turn Launch deps that record every side effect, in order, as one line each. */
function recordingDeps(
  opts: {
    engineFails?: boolean
    /** A plan still pending on the chat. */
    pendingPlan?: string
    /** Whether resolving a plan finds it still pending (default true). */
    planStillPending?: boolean
    /**
     * What the scripted Engine reports, once its session is open, about
     * whether the run takes Steers. Unset: it reports nothing.
     */
    reportsSteering?: boolean
    /**
     * The chat's run that hasn't finished, by id and status, and whether it
     * takes Steers as its record says (a run this deps recorded overrides it).
     */
    activeRun?: {
      id: string
      status: "running" | "paused_for_plan"
      steers?: boolean | null
    }
    /** The active run ends just as a Steer is recorded on it. */
    runEndsWhileSteering?: boolean
    /** Whether a Steer is still pending when taken back (default true). */
    steerReclaimable?: boolean
    /** Steers the run never took, drained once it's over. */
    leftovers?: Steer[]
    /** How the driven run ended (default completed). */
    runStatus?: RunStatus
    /** The status of the chat's most recent run (default none). */
    latestRun?: RunStatus
  } = {}
) {
  const log: string[] = []
  const echoes: SessionUpdate[] = []
  const afterResponse: Array<() => Promise<void>> = []
  const leftovers = [...(opts.leftovers ?? [])]
  // Whether each run takes Steers, as recorded when its Engine reported.
  const recorded = new Map<string, boolean>()
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
    async persistUserTurn(_chatId, userText, sentBy) {
      log.push(`persist ${userText}${sentBy ? ` by ${sentBy}` : ""}`)
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
      echoes.push(update)
    },
    async broadcastControl(_roomId, _chatId, control) {
      log.push(
        control.kind === "plan_resolved"
          ? `broadcast plan_resolved ${control.approved ? "approved" : "rejected"}`
          : control.kind === "steerable"
            ? `broadcast steerable${control.steerable ? "" : " (no)"}`
            : control.kind === "steers_returned"
              ? `broadcast steers_returned ${control.steers.map((s) => s.message).join(" + ")}`
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
      log.push(
        `drive ${turn.runId} planMode=${turn.planMode ?? false}${turn.wake ? " wake" : ""}`
      )
      // The scripted Engine's session opens, and it says whether it steers.
      if (opts.reportsSteering !== undefined) {
        await turn.reportSteering(opts.reportsSteering)
      }
    },
    async loadRunStatus() {
      return opts.runStatus ?? "completed"
    },
    async wakeCoordinator({ runId, status }) {
      log.push(`wake coordinator ${runId} ${status}`)
    },
    runAfterResponse(task) {
      log.push("response sent")
      afterResponse.push(task)
    },
    async findActiveRun() {
      const active = opts.activeRun
      if (!active) return null
      return {
        id: active.id,
        status: active.status,
        steers: recorded.get(active.id) ?? active.steers ?? null,
      }
    },
    async recordSteering(runId, steers) {
      log.push(`record ${runId} ${steers ? "steers" : "doesn't steer"}`)
      if (!recorded.has(runId)) recorded.set(runId, steers)
    },
    async isRunActive() {
      return !opts.runEndsWhileSteering
    },
    async latestRunStatus() {
      return opts.latestRun ?? null
    },
    steers: {
      async add({ runId, message, userId }) {
        log.push(`add steer to ${runId}: ${message}`)
        return { id: "steer_1", message, userId }
      },
      async drain(runId) {
        const left = leftovers.splice(0)
        if (left.length > 0) log.push(`drain ${left.length} from ${runId}`)
        return left
      },
      async reclaim(id) {
        const reclaimed = opts.steerReclaimable !== false
        log.push(`reclaim ${id}: ${reclaimed ? "taken back" : "already gone"}`)
        return reclaimed
      },
    },
  }
  const flush = async () => {
    for (const task of afterResponse) await task()
  }
  return { deps, log, flush, opts, echoes }
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

  it("records who sent the message on the stored turn and its echo", async () => {
    const { deps, log, echoes } = recordingDeps()
    await launchTurn(deps, { ...request, userId: "user_maya" }, target(log))
    expect(log).toContain("persist fix it by user_maya")
    expect(echoedUserTurn(echoes[0]!)).toMatchObject({ sentBy: "user_maya" })
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

  it("marks the engine turn as a wake when its message is a Coordinator wake (#1224)", async () => {
    const wake = recordingDeps()
    await launchTurn(
      wake.deps,
      request,
      target(wake.log, {
        userText: "[workspace update: ws-1] Workspace finished.",
      })
    )
    await wake.flush()
    expect(wake.log).toContain("drive run_1 planMode=false wake")

    const typed = recordingDeps()
    await launchTurn(typed.deps, request, target(typed.log))
    await typed.flush()
    expect(typed.log).toContain("drive run_1 planMode=false")
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

describe("Turn Launch — retrying a failed turn (#1228)", () => {
  it("runs the turn on the ask already stored, without storing or echoing it again", async () => {
    const { deps, log, flush } = recordingDeps({ latestRun: "failed" })
    const result = await launchTurn(
      deps,
      { ...request, retry: true },
      target(log)
    )
    expect(result).toEqual({ kind: "started", runId: "run_1" })
    await flush()
    expect(log).toEqual([
      "resolve engine",
      "prepare target",
      "start run",
      "broadcast chat-stream-start",
      "response sent",
      "drive run_1 planMode=false",
    ])
  })

  it("sends the ask as new when another turn followed the failed one", async () => {
    const { deps, log } = recordingDeps({ latestRun: "completed" })
    await launchTurn(deps, { ...request, retry: true }, target(log))
    expect(log).toContain("persist fix it")
    expect(log).toContain("broadcast user_message_chunk")
  })
})

describe("Turn Launch — steering (#1190)", () => {
  const running = { id: "run_9", status: "running" as const, steers: true }
  const steerRequest = { ...request, message: "use the v2 API", userId: "u_1" }

  it("an idle chat starts an ordinary turn", async () => {
    const { deps, log } = recordingDeps()
    const result = await launchTurn(deps, steerRequest, target(log))
    expect(result).toEqual({ kind: "started", runId: "run_1" })
    expect(log).toContain("start run")
  })

  it("a running, steerable chat takes the message as a pending Steer, never superseding the run", async () => {
    const { deps, log } = recordingDeps({ activeRun: running })
    const result = await launchTurn(deps, steerRequest, target(log))

    expect(result).toEqual({ kind: "steered", steerId: "steer_1" })
    expect(log).toEqual([
      "resolve engine",
      "add steer to run_9: use the v2 API",
      "broadcast steer_pending",
    ])
  })

  it("a running chat whose run doesn't steer is refused as not steerable, with nothing written", async () => {
    const { deps, log } = recordingDeps({
      activeRun: { ...running, steers: false },
    })
    const result = await launchTurn(deps, steerRequest, target(log))

    expect(result).toEqual({ kind: "not-steerable" })
    expect(log).toEqual(["resolve engine"])
  })

  it("a chat paused on a plan still implicitly rejects it with a new turn", async () => {
    const { deps, log } = recordingDeps({
      activeRun: { id: "run_9", status: "paused_for_plan" },
      pendingPlan: "plan_1",
    })
    const result = await launchTurn(deps, steerRequest, target(log))

    expect(result).toEqual({ kind: "started", runId: "run_1" })
    expect(log).toContain("resolve plan plan_1 rejected (use the v2 API)")
    expect(log.some((l) => l.startsWith("add steer"))).toBe(false)
  })

  describe("decided when the Engine's session opens (#1250)", () => {
    /** Start a turn, then send another message while its run is going. */
    async function sendMidTurn(
      h: ReturnType<typeof recordingDeps>,
      opts: { drive: boolean }
    ) {
      await launchTurn(h.deps, request, target(h.log))
      if (opts.drive) await h.flush()
      h.opts.activeRun = { id: "run_1", status: "running" }
      const before = h.log.length
      const result = await launchTurn(h.deps, steerRequest, target(h.log))
      return { result, log: h.log.slice(before) }
    }

    it("says nothing about steering when the turn starts", async () => {
      const { deps, log } = recordingDeps({ reportsSteering: true })
      await launchTurn(deps, request, target(log))
      expect(log.some((l) => l.includes("steer"))).toBe(false)
    })

    it("records the Engine's answer on the run, then tells clients", async () => {
      const steers = recordingDeps({ reportsSteering: true })
      await launchTurn(steers.deps, request, target(steers.log))
      await steers.flush()
      expect(steers.log.slice(-2)).toEqual([
        "record run_1 steers",
        "broadcast steerable",
      ])

      const queues = recordingDeps({ reportsSteering: false })
      await launchTurn(queues.deps, request, target(queues.log))
      await queues.flush()
      expect(queues.log.slice(-2)).toEqual([
        "record run_1 doesn't steer",
        "broadcast steerable (no)",
      ])
    })

    it("a run whose Engine reports no refuses a later send, which never reaches the Steer inbox", async () => {
      const h = recordingDeps({ reportsSteering: false })
      const { result, log } = await sendMidTurn(h, { drive: true })

      expect(result).toEqual({ kind: "not-steerable" })
      expect(log).toEqual(["resolve engine"])
    })

    it("a run whose Engine reports yes takes a later send as a Steer", async () => {
      const h = recordingDeps({ reportsSteering: true })
      const { result, log } = await sendMidTurn(h, { drive: true })

      expect(result).toEqual({ kind: "steered", steerId: "steer_1" })
      expect(log).toEqual([
        "resolve engine",
        "add steer to run_1: use the v2 API",
        "broadcast steer_pending",
      ])
    })

    it("a send that arrives before the Engine has reported is refused, not taken", async () => {
      const h = recordingDeps({ reportsSteering: true })
      const { result, log } = await sendMidTurn(h, { drive: false })

      expect(result).toEqual({ kind: "not-steerable" })
      expect(log).toEqual(["resolve engine"])
    })

    it("only the first report counts", async () => {
      const { deps, log, flush } = recordingDeps()
      await launchTurn(
        {
          ...deps,
          async driveTurn(turn) {
            await turn.reportSteering(false)
            await turn.reportSteering(true)
          },
        },
        request,
        target(log)
      )
      await flush()
      expect(log.filter((l) => l.includes("steer"))).toEqual([
        "record run_1 doesn't steer",
        "broadcast steerable (no)",
      ])
    })
  })

  it("a run that ends while its Steer is recorded gives it back to start the turn itself", async () => {
    const { deps, log } = recordingDeps({
      activeRun: running,
      runEndsWhileSteering: true,
    })
    const result = await launchTurn(deps, steerRequest, target(log))

    expect(result).toEqual({ kind: "started", runId: "run_1" })
    expect(log.slice(0, 6)).toEqual([
      "resolve engine",
      "add steer to run_9: use the v2 API",
      "broadcast steer_pending",
      "reclaim steer_1: taken back",
      "broadcast steers_taken",
      "prepare target",
    ])
  })

  it("a Steer the ending run already drained stays with that run's next turn", async () => {
    const { deps, log } = recordingDeps({
      activeRun: running,
      runEndsWhileSteering: true,
      steerReclaimable: false,
    })
    const result = await launchTurn(deps, steerRequest, target(log))

    expect(result).toEqual({ kind: "steered", steerId: "steer_1" })
    expect(log).not.toContain("start run")
  })

  describe("leftovers", () => {
    const leftovers: Steer[] = [
      { id: "s1", message: "use the v2 API", userId: "u_1" },
      { id: "s2", message: "and keep v1", userId: "u_2" },
    ]
    /** A target whose follow-up turns log the message they carry. */
    const followingTarget = (log: string[]) => ({
      ...target(log),
      followUp: (message: string) => {
        log.push(`follow up: ${message.replace("\n\n", " / ")}`)
        return target(log, { userText: message })
      },
    })

    for (const status of ["completed", "failed", "paused_for_plan"] as const) {
      it(`start the next turn at once, joined oldest first, when the run ${status === "paused_for_plan" ? "paused for a plan" : status}`, async () => {
        const { deps, log, flush } = recordingDeps({
          leftovers,
          runStatus: status,
        })
        await launchTurn(deps, request, followingTarget(log))
        const before = log.length
        await flush()

        expect(log.slice(before)).toEqual([
          "drive run_1 planMode=false",
          "drain 2 from run_1",
          "broadcast steers_taken",
          "follow up: use the v2 API / and keep v1",
          "resolve engine",
          "prepare target",
          // Two senders' words in one message: it names neither.
          "persist use the v2 API\n\nand keep v1",
          "start run",
          "broadcast chat-stream-start",
          "broadcast user_message_chunk",
          "drive run_1 planMode=false",
        ])
      })
    }

    it("wake the Coordinator about the ended turn before the next one runs", async () => {
      const { deps, log, flush } = recordingDeps({ leftovers })
      await launchTurn(deps, request, {
        ...followingTarget(log),
        prepare: async () => ({
          systemPrompt: "sys",
          model: "m",
          tools: {},
          userText: "fix it",
          wakesCoordinator: true,
        }),
      })
      await flush()

      const wake = log.indexOf("wake coordinator run_1 completed")
      const nextDrive = log.lastIndexOf("drive run_1 planMode=false")
      expect(wake).toBeGreaterThan(
        log.indexOf(
          "start run",
          log.indexOf("follow up: use the v2 API / and keep v1")
        )
      )
      expect(wake).toBeLessThan(nextDrive)
    })

    it("go back to their senders when the run was stopped", async () => {
      const { deps, log, flush } = recordingDeps({
        leftovers,
        runStatus: "aborted",
      })
      await launchTurn(deps, request, followingTarget(log))
      await flush()

      expect(log.slice(-2)).toEqual([
        "drain 2 from run_1",
        "broadcast steers_returned use the v2 API + and keep v1",
      ])
      expect(log.some((l) => l.startsWith("follow up"))).toBe(false)
    })
  })
})

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
