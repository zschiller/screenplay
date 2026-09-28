import { describe, expect, it } from "vitest"
import type { Engine } from "./acp/engine-seam"
import {
  launchTurn,
  type PreparedTurn,
  type TurnLaunchDeps,
} from "./turn-launch"

const ENGINE = { run: async () => {} } as unknown as Engine

/** Turn Launch deps that record every side effect, in order, as one line each. */
function recordingDeps(opts: { engineFails?: boolean } = {}) {
  const log: string[] = []
  const afterResponse: Array<() => Promise<void>> = []
  const deps: TurnLaunchDeps = {
    async resolveEngine() {
      log.push("resolve engine")
      if (opts.engineFails) throw new Error("AGENT_ENGINE misconfigured")
      return ENGINE
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
      log.push(`broadcast ${control.kind}`)
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
  it("orders a sandbox turn: engine, target, persist, run, start marker, echo, renames, then the engine after the response", async () => {
    const { deps, log, flush } = recordingDeps()
    const result = await launchTurn(
      deps,
      request,
      target(log, {
        userText: "[branch: fix-it] fix it",
        planMode: true,
        renames: { branch: "fix-it", label: "Fix it" },
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
      // The start marker opens the replay window, so the echo and the renames
      // after it reach a client that joins mid-stream.
      "broadcast chat-stream-start",
      "broadcast user_message_chunk",
      "broadcast branch_rename",
      "broadcast chat_rename",
      "queue comments t1",
      "response sent",
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

  it("a layer turn has no renames or comment request", async () => {
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
})
