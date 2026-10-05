import { describe, expect, it } from "vitest"
import type { AcpMessageRecord } from "@/lib/agent/acp/record"
import { textBlock } from "@/lib/agent/acp/schema"
import type { Engine } from "@/lib/agent/acp/engine-seam"
import { parseUserMessage } from "@/lib/agent/message-markers"
import {
  launchTurn,
  type TurnLaunchDeps,
  type TurnTarget,
} from "@/lib/agent/turn-launch"
import type { PrEventKind } from "./watch"
import {
  consecutivePrWakes,
  deliverPrWakes,
  PR_WAKE_CAP,
  type ChatPrEvent,
  type PrWakePorts,
} from "./wake"

const ROOM = "room-1"
const CHAT = "chat-1"

/**
 * One Workspace Chat behind the real Turn Launch, with a fake engine: a turn's
 * message lands in `history`, its run stays active until `finishTurns`, and
 * the engine answers with one agent line.
 */
function fakeChat() {
  const history: AcpMessageRecord[] = []
  const engineRan: string[] = []
  const paused: number[] = []
  const pending: Array<() => Promise<void>> = []
  let active: { id: string; status: "running" } | null = null
  let runs = 0

  const engine: Engine = {
    id: "fake",
    async run() {},
  }
  const deps: TurnLaunchDeps = {
    resolveEngine: async () => engine,
    findPendingPlan: async () => null,
    resolvePlan: async () => null,
    async persistUserTurn(_chatId, userText, sentBy) {
      history.push({
        role: "user",
        content: [textBlock(userText)],
        ...(sentBy ? { sentBy } : {}),
      })
    },
    async startRun() {
      const id = `run_${++runs}`
      active = { id, status: "running" }
      return id
    },
    broadcastStreamStart: async () => {},
    broadcastUpdate: async () => {},
    broadcastControl: async () => {},
    renameBranch: async () => {},
    moveMergedBranch: async () => "",
    queueCommentRequest: async () => {},
    startCommentRequest: async () => {},
    settleCommentRequest: async () => {},
    async driveTurn(turn) {
      engineRan.push(turn.runId)
      history.push({ role: "agent", content: [textBlock("Fixed and pushed.")] })
      active = null
    },
    loadRunStatus: async () => "completed",
    wakeCoordinator: async () => {},
    runAfterResponse(task) {
      pending.push(task)
    },
    findActiveRun: async () => active && { ...active, steers: true },
    recordSteering: async () => {},
    isRunActive: async () => active !== null,
    latestRunStatus: async () => null,
    steers: {
      add: async ({ message, userId }) => ({ id: "s", message, userId }),
      drain: async () => [],
      reclaim: async () => false,
    },
  }
  const turnTarget = (userText: string): TurnTarget => ({
    prepare: async () => ({
      systemPrompt: "",
      model: "m",
      tools: {},
      userText,
    }),
  })

  const ports: PrWakePorts = {
    history: async () => history,
    async addLine(_event, wire) {
      history.push({ role: "user", content: [textBlock(wire)] })
    },
    async launch(_event, wire) {
      const result = await launchTurn(
        deps,
        {
          roomId: ROOM,
          chatId: CHAT,
          message: wire,
          userId: "owner",
          sentBy: null,
          queueBehindRun: true,
        },
        turnTarget(wire)
      )
      if (result.kind === "started") return "started"
      return result.kind === "busy" ? "busy" : "unavailable"
    },
    async pauseWakes({ number }) {
      paused.push(number)
    },
  }

  return {
    ports,
    history,
    engineRan,
    paused,
    /** A person types in the chat. */
    async send(message: string) {
      await launchTurn(
        deps,
        { roomId: ROOM, chatId: CHAT, message, userId: "maya" },
        turnTarget(message)
      )
    },
    /** Let every started turn's engine run to its end. */
    async finishTurns() {
      while (pending.length > 0) await pending.shift()!()
    },
    /** The PR events in the transcript, as `<number> <kind>`. */
    lines() {
      return history.flatMap((r) => {
        if (r.role !== "user") return []
        const { prEvent } = parseUserMessage(
          r.content.map((b) => (b.type === "text" ? b.text : "")).join("")
        )
        return prEvent ? [`${prEvent.number} ${prEvent.kind}`] : []
      })
    },
  }
}

const event = (kind: PrEventKind, number = 7): ChatPrEvent => ({
  chatId: CHAT,
  branchId: "b1",
  number,
  url: `https://github.com/o/r/pull/${number}`,
  kind,
})

describe("PR wakes (#1703)", () => {
  it.each(["checks_failed", "conflict", "merged", "closed"] as const)(
    "%s queues one wake turn on the Workspace Chat",
    async (kind) => {
      const chat = fakeChat()
      const held = await deliverPrWakes(chat.ports, [], [event(kind)])
      await chat.finishTurns()

      expect(held).toEqual([])
      expect(chat.engineRan).toEqual(["run_1"])
      expect(chat.lines()).toEqual([`7 ${kind}`])
    }
  )

  it("checks passing again is only a line", async () => {
    const chat = fakeChat()
    await deliverPrWakes(chat.ports, [], [event("checks_passed")])
    await chat.finishTurns()

    expect(chat.engineRan).toEqual([])
    expect(chat.lines()).toEqual(["7 checks_passed"])
  })

  it("waits for a turn in flight, then wakes on the next look", async () => {
    const chat = fakeChat()
    await chat.send("make the button blue")

    const held = await deliverPrWakes(chat.ports, [], [event("checks_failed")])
    expect(held).toEqual([event("checks_failed")])
    expect(chat.lines()).toEqual([])

    await chat.finishTurns()
    expect(chat.engineRan).toEqual(["run_1"])

    expect(await deliverPrWakes(chat.ports, held, [])).toEqual([])
    await chat.finishTurns()
    expect(chat.engineRan).toEqual(["run_1", "run_2"])
    expect(chat.lines()).toEqual(["7 checks_failed"])
  })

  it("keeps a chat's later events behind its wake, in order", async () => {
    const chat = fakeChat()
    const held = await deliverPrWakes(
      chat.ports,
      [],
      [event("checks_failed"), event("checks_passed")]
    )
    expect(held).toEqual([event("checks_passed")])
    await chat.finishTurns()

    await deliverPrWakes(chat.ports, held, [])
    expect(chat.lines()).toEqual(["7 checks_failed", "7 checks_passed"])
  })

  it(`stops waking after ${PR_WAKE_CAP} wakes in a row and pauses the PR instead`, async () => {
    const chat = fakeChat()
    for (let i = 0; i < PR_WAKE_CAP; i++) {
      await deliverPrWakes(chat.ports, [], [event("checks_failed")])
      await chat.finishTurns()
    }
    expect(chat.engineRan).toHaveLength(PR_WAKE_CAP)

    await deliverPrWakes(chat.ports, [], [event("checks_failed")])
    await chat.finishTurns()

    expect(chat.engineRan).toHaveLength(PR_WAKE_CAP)
    expect(chat.lines()).toHaveLength(PR_WAKE_CAP + 1)
    expect(chat.paused).toEqual([7])
  })

  it("a message from a person restarts the count", async () => {
    const chat = fakeChat()
    for (let i = 0; i < PR_WAKE_CAP; i++) {
      await deliverPrWakes(chat.ports, [], [event("checks_failed")])
      await chat.finishTurns()
    }
    await chat.send("try pinning the lint version")
    await chat.finishTurns()

    await deliverPrWakes(chat.ports, [], [event("checks_failed")])
    await chat.finishTurns()

    expect(chat.paused).toEqual([])
    expect(chat.engineRan).toHaveLength(PR_WAKE_CAP + 2)
  })

  it("counts wakes per PR", () => {
    const line = (number: number, kind: PrEventKind): AcpMessageRecord => ({
      role: "user",
      content: [textBlock(`[pr event: ${number} ${kind}] …`)],
    })
    const history: AcpMessageRecord[] = [
      { role: "user", content: [textBlock("ship it")], sentBy: "maya" },
      line(6, "checks_failed"),
      line(7, "checks_failed"),
      line(7, "checks_passed"),
      // A Coordinator's Delegated Message has no sender: no reset.
      { role: "user", content: [textBlock("[from coordinator: c] go on")] },
      line(7, "conflict"),
    ]
    expect(consecutivePrWakes(history, 7)).toBe(2)
    expect(consecutivePrWakes(history, 6)).toBe(1)
  })

  it("a Workspace that can't take a turn still shows the line", async () => {
    const chat = fakeChat()
    const ports: PrWakePorts = {
      ...chat.ports,
      launch: async () => "unavailable",
    }
    expect(await deliverPrWakes(ports, [], [event("merged")])).toEqual([])
    expect(chat.lines()).toEqual(["7 merged"])
  })
})
