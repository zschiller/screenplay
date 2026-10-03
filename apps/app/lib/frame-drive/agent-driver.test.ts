import { describe, expect, it } from "vitest"

import {
  AGENT_PARTY,
  EMPTY_FRAME_CONTROL,
  reduceFrameControl,
  type FrameControlRecord,
} from "@/lib/canvas/frame-control"
import {
  AGENT_IDLE_RELEASE_MS,
  AgentFrameDriver,
  agentAsksInChat,
  agentAsksToDrive,
  agentLetsGo,
  memoryFrameControlStore,
} from "@/lib/frame-drive/agent-driver"
import type {
  DriveOp,
  DriveResult,
  FrameDriveBackend,
} from "@/lib/frame-drive/contract"

const ZACK = "user-zack"
const ANA = "user-ana"
const CLICK: DriveOp = { op: "click", target: { text: "Save" } }
const DONE: DriveResult = {
  status: "done",
  value: { op: "click", path: "/" },
}

const record = (
  driver: string | null,
  requests: { by: string; at: number }[] = []
): FrameControlRecord => ({ live: false, driver, requests })

describe("agentAsksToDrive", () => {
  it("drives a frame it already drives", () => {
    const r = record(AGENT_PARTY)
    expect(agentAsksToDrive(r, { at: 1, heldBefore: true })).toEqual({
      kind: "drive",
      record: r,
    })
  })

  it("picks up a frame nobody drives", () => {
    const decision = agentAsksToDrive(EMPTY_FRAME_CONTROL, {
      at: 1,
      heldBefore: false,
    })
    expect(decision.kind).toBe("drive")
    expect(decision.record.driver).toBe(AGENT_PARTY)
  })

  it("waits behind a person who drives, its request queued", () => {
    const decision = agentAsksToDrive(record(ZACK), {
      at: 5,
      heldBefore: false,
    })
    expect(decision).toEqual({
      kind: "wait",
      record: record(ZACK, [{ by: AGENT_PARTY, at: 5 }]),
      driver: ZACK,
      takenOver: false,
    })
  })

  it("fails the next gesture after a person takes over, and queues to get it back", () => {
    // The agent drove; the person pressed the driver button.
    const taken = reduceFrameControl(record(AGENT_PARTY), {
      type: "request",
      by: ZACK,
      at: 3,
    })
    expect(taken.driver).toBe(ZACK)
    const decision = agentAsksToDrive(taken, { at: 4, heldBefore: true })
    expect(decision).toMatchObject({ kind: "wait", takenOver: true })
    expect(decision.record.requests).toEqual([{ by: AGENT_PARTY, at: 4 }])
    // When the person leaves Interact, the agent carries on.
    const released = reduceFrameControl(decision.record, {
      type: "release",
      by: ZACK,
      presence: { online: new Set([ZACK]), goneAt: new Map() },
    })
    expect(released.driver).toBe(AGENT_PARTY)
  })

  it("doesn't pick a frame straight back up after it was taken over, even if the person already let go", () => {
    const decision = agentAsksToDrive(EMPTY_FRAME_CONTROL, {
      at: 4,
      heldBefore: true,
    })
    expect(decision).toEqual({
      kind: "wait",
      record: EMPTY_FRAME_CONTROL,
      driver: null,
      takenOver: true,
    })
  })
})

describe("agentAsksInChat", () => {
  const ask = (
    r: FrameControlRecord,
    opts: Partial<Parameters<typeof agentAsksInChat>[1]> = {}
  ) =>
    agentAsksInChat(r, {
      asker: ZACK,
      at: 5,
      heldBefore: false,
      takenBy: null,
      ...opts,
    })

  it("drives a frame nobody drives, with no second prompt", () => {
    const decision = ask(EMPTY_FRAME_CONTROL)
    expect(decision.kind).toBe("drive")
    expect(decision.record.driver).toBe(AGENT_PARTY)
  })

  it("takes the frame from the asker, who is the one asking", () => {
    const decision = ask(record(ZACK))
    expect(decision.kind).toBe("drive")
    expect(decision.record.driver).toBe(AGENT_PARTY)
  })

  it("queues behind someone else who drives", () => {
    expect(ask(record(ANA))).toEqual({
      kind: "wait",
      record: record(ANA, [{ by: AGENT_PARTY, at: 5 }]),
      driver: ANA,
      takenOver: false,
    })
  })

  it("never undoes a take-over: it waits for the asker to leave Interact", () => {
    // Taken over since its last step.
    expect(ask(record(ZACK), { heldBefore: true })).toMatchObject({
      kind: "wait",
      driver: ZACK,
      takenOver: true,
      record: record(ZACK, [{ by: AGENT_PARTY, at: 5 }]),
    })
    // Taken over earlier, and they still have it.
    expect(ask(record(ZACK), { takenBy: ZACK })).toMatchObject({
      kind: "wait",
      takenOver: true,
    })
  })

  it("drives again once the person who took over let go", () => {
    expect(ask(EMPTY_FRAME_CONTROL, { takenBy: ZACK }).kind).toBe("drive")
    expect(ask(EMPTY_FRAME_CONTROL, { heldBefore: true }).kind).toBe("drive")
  })
})

describe("agentLetsGo", () => {
  const presence = { online: new Set([ZACK]), goneAt: new Map() }

  it("stops driving", () => {
    expect(agentLetsGo(record(AGENT_PARTY), presence).driver).toBeNull()
  })

  it("withdraws its place in the queue", () => {
    expect(
      agentLetsGo(record(ZACK, [{ by: AGENT_PARTY, at: 1 }]), presence)
    ).toEqual(record(ZACK))
  })
})

/** A backend that records ops and answers each gesture with `answer`. */
function fakeBackend(
  answer: () => DriveResult = () => DONE,
  unavailable: string | null = null
) {
  const ops: DriveOp[] = []
  const reveals: string[] = []
  const backend: FrameDriveBackend = {
    unavailable: async () => unavailable,
    run: async (_frameId, op) => {
      ops.push(op)
      return answer()
    },
    screenshot: async () => ({ status: "unavailable", reason: "no shell" }),
  }
  /** The asker's canvas bringing a frame into view. */
  const reveal = async (frameId: string) => {
    reveals.push(frameId)
    return null
  }
  return { backend, ops, reveals, reveal }
}

function makeDriver(
  backend: FrameDriveBackend,
  reveal?: (frameId: string) => Promise<string | null>
) {
  const store = memoryFrameControlStore()
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = []
  const driver = new AgentFrameDriver({
    backend,
    store,
    keyOf: (frameId) => `${frameId}:${ZACK}`,
    presence: () => ({ online: new Set([ZACK]), goneAt: new Map() }),
    reveal,
    now: () => 100,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer) => {
      ;(timer as { cleared: boolean }).cleared = true
    },
  })
  const fireIdle = () => timers.filter((t) => !t.cleared).forEach((t) => t.fn())
  return { driver, store, timers, fireIdle }
}

describe("AgentFrameDriver", () => {
  it("takes an undriven frame and drives it", async () => {
    const { backend, ops } = fakeBackend()
    const { driver, store } = makeDriver(backend)
    expect(await driver.run("f1", CLICK)).toEqual(DONE)
    expect(ops).toEqual([CLICK])
    expect(store.records.get(`f1:${ZACK}`)?.driver).toBe(AGENT_PARTY)
  })

  it("never drives while the person does, and doesn't touch the page", async () => {
    const { backend, ops } = fakeBackend()
    const { driver, store } = makeDriver(backend)
    store.records.set(`f1:${ZACK}`, record(ZACK))
    expect(await driver.run("f1", CLICK)).toEqual({
      status: "wait",
      driver: ZACK,
      takenOver: false,
    })
    expect(ops).toEqual([])
  })

  it("stops after the person takes over, and says so, rather than fighting", async () => {
    const { backend, ops } = fakeBackend()
    const { driver, store } = makeDriver(backend)
    await driver.run("f1", CLICK)
    // The person presses the driver button.
    const key = `f1:${ZACK}`
    store.records.set(
      key,
      reduceFrameControl(store.records.get(key)!, {
        type: "request",
        by: ZACK,
        at: 200,
      })
    )
    expect(await driver.run("f1", CLICK)).toMatchObject({
      status: "wait",
      takenOver: true,
    })
    expect(ops).toHaveLength(1)
    expect(store.records.get(key)?.driver).toBe(ZACK)
  })

  it("reports a take-over the canvas saw before the gesture ran", async () => {
    const { backend } = fakeBackend(() => ({ status: "taken" }))
    const { driver } = makeDriver(backend)
    expect(await driver.run("f1", CLICK)).toEqual({
      status: "wait",
      driver: null,
      takenOver: true,
    })
  })

  it("doesn't ask Frame Control for a frame it can't reach", async () => {
    const { backend, ops } = fakeBackend(() => DONE, "the canvas isn't open")
    const { driver, store } = makeDriver(backend)
    expect(await driver.run("f1", CLICK)).toEqual({
      status: "unavailable",
      reason: "the canvas isn't open",
    })
    expect(ops).toEqual([])
    expect(store.records.size).toBe(0)
  })

  it("reads without taking control", async () => {
    const { backend, ops } = fakeBackend(() => ({
      status: "read",
      value: {
        path: "/",
        title: "",
        viewport: { width: 1, height: 1 },
        scroll: { x: 0, y: 0 },
        elements: [],
      },
    }))
    const { driver, store } = makeDriver(backend)
    store.records.set(`f1:${ZACK}`, record(ZACK))
    expect((await driver.run("f1", { op: "elements" })).status).toBe("read")
    expect(ops).toEqual([{ op: "elements" }])
    expect(store.records.get(`f1:${ZACK}`)).toEqual(record(ZACK))
  })

  it("lets go when asked", async () => {
    const { backend } = fakeBackend()
    const { driver, store } = makeDriver(backend)
    await driver.run("f1", CLICK)
    await driver.letGo("f1")
    expect(store.records.size).toBe(0)
    // Letting go isn't a take-over: the next gesture picks the frame up.
    expect(await driver.run("f1", CLICK)).toEqual(DONE)
  })

  it("lets go of a frame, or its place in the queue, after going idle", async () => {
    const { backend } = fakeBackend()
    const { driver, store, timers, fireIdle } = makeDriver(backend)
    await driver.run("f1", CLICK)
    expect(timers.at(-1)?.ms).toBe(AGENT_IDLE_RELEASE_MS)
    fireIdle()
    await Promise.resolve()
    expect(store.records.size).toBe(0)

    store.records.set(`f2:${ZACK}`, record(ZACK))
    await driver.run("f2", CLICK)
    expect(store.records.get(`f2:${ZACK}`)?.requests).toHaveLength(1)
    fireIdle()
    await Promise.resolve()
    expect(store.records.get(`f2:${ZACK}`)).toEqual(record(ZACK))
  })

  describe("started from a chat ask", () => {
    it("shows: drives the asker's frame, brings it into view, and paces every step", async () => {
      const { backend, ops, reveals, reveal } = fakeBackend()
      const { driver, store } = makeDriver(backend, reveal)
      // The person is interacting with the frame when they ask.
      store.records.set(`f1:${ZACK}`, record(ZACK))
      expect(await driver.start("f1", { asker: ZACK, pace: "show" })).toEqual({
        status: "driving",
      })
      expect(reveals).toEqual(["f1"])
      expect(store.records.get(`f1:${ZACK}`)?.driver).toBe(AGENT_PARTY)
      await driver.run("f1", CLICK)
      expect(ops).toEqual([{ ...CLICK, pace: "show" }])
    })

    it("jumps: no animation, and nobody's view moves", async () => {
      const { backend, ops, reveals, reveal } = fakeBackend()
      const { driver } = makeDriver(backend, reveal)
      await driver.start("f1", { asker: ZACK, pace: "jump" })
      await driver.run("f1", CLICK)
      expect(reveals).toEqual([])
      expect(ops).toEqual([{ ...CLICK, pace: "jump" }])
    })

    it("plays steps at once again after it lets go", async () => {
      const { backend, ops, reveal } = fakeBackend()
      const { driver } = makeDriver(backend, reveal)
      await driver.start("f1", { asker: ZACK, pace: "show" })
      await driver.letGo("f1")
      await driver.run("f1", CLICK)
      expect(ops).toEqual([CLICK])
    })

    it("doesn't take the frame back from the person who took over", async () => {
      const { backend, ops, reveals, reveal } = fakeBackend()
      const { driver, store } = makeDriver(backend, reveal)
      await driver.start("f1", { asker: ZACK, pace: "show" })
      const key = `f1:${ZACK}`
      store.records.set(
        key,
        reduceFrameControl(store.records.get(key)!, {
          type: "request",
          by: ZACK,
          at: 200,
        })
      )
      expect(await driver.run("f1", CLICK)).toMatchObject({
        status: "wait",
        takenOver: true,
      })
      // Asked again in chat while they still drive: it still waits.
      expect(await driver.start("f1", { asker: ZACK, pace: "show" })).toEqual({
        status: "wait",
        driver: ZACK,
        takenOver: true,
      })
      expect(store.records.get(key)?.driver).toBe(ZACK)
      expect(ops).toEqual([])
      expect(reveals).toEqual(["f1"])
    })

    it("doesn't take the frame back after a take-over the canvas saw mid-step", async () => {
      const key = `f1:${ZACK}`
      const records = { current: new Map<string, FrameControlRecord>() }
      // The person presses Interact while the cursor glides: the canvas
      // refuses the step.
      const { backend, reveals, reveal } = fakeBackend(() => {
        records.current.set(key, record(ZACK))
        return { status: "taken" }
      })
      const { driver, store } = makeDriver(backend, reveal)
      records.current = store.records
      await driver.start("f1", { asker: ZACK, pace: "show" })
      expect(await driver.run("f1", CLICK)).toEqual({
        status: "wait",
        driver: ZACK,
        takenOver: true,
      })
      expect(await driver.start("f1", { asker: ZACK, pace: "show" })).toEqual({
        status: "wait",
        driver: ZACK,
        takenOver: true,
      })
      expect(store.records.get(key)?.driver).toBe(ZACK)
      expect(reveals).toEqual(["f1"])
    })

    it("says so when the canvas can't be reached", async () => {
      const { backend, reveal } = fakeBackend(
        () => DONE,
        "the canvas isn't open"
      )
      const { driver, store } = makeDriver(backend, reveal)
      expect(await driver.start("f1", { asker: ZACK, pace: "show" })).toEqual({
        status: "unavailable",
        reason: "the canvas isn't open",
      })
      expect(store.records.size).toBe(0)
    })
  })
})
