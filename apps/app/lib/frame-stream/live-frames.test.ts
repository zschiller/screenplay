import { describe, expect, it } from "vitest"

import { AGENT_PARTY } from "@/lib/canvas/frame-control"
import {
  landOnLiveFrames,
  liveFrames,
  presenceLiveFrameIds,
  type LiveChoices,
  type LivePresence,
} from "./live-frames"

const ME = "zack"
const NONE: LiveChoices = { joined: new Set(), left: new Set() }
const nobodyDrives = () => null

function rule({
  frameIds = ["a", "b"],
  others = [] as LivePresence[],
  choices = NONE,
  drivers = nobodyDrives as (id: string) => string | null,
} = {}) {
  return liveFrames({ frameIds, viewerId: ME, others, choices, drivers })
}

describe("liveFrames", () => {
  it("keeps every frame an own copy while nobody is live", () => {
    const frames = rule()
    expect(frames.get("a")).toEqual({ live: false, on: [], viewerOn: false })
    expect(frames.get("b")).toEqual({ live: false, on: [], viewerOn: false })
  })

  it("puts you alone on a frame you go live on", () => {
    const frames = rule({
      choices: { joined: new Set(["a"]), left: new Set() },
    })
    expect(frames.get("a")).toEqual({ live: true, on: [ME], viewerOn: true })
    expect(frames.get("b")?.live).toBe(false)
  })

  it("shows a frame someone else is live on as live, without you on it", () => {
    const frames = rule({ others: [{ id: "ana", liveFrameIds: ["a"] }] })
    expect(frames.get("a")).toEqual({
      live: true,
      on: ["ana"],
      viewerOn: false,
    })
  })

  it("counts each person once, whatever tabs they have open", () => {
    const frames = rule({
      others: [
        { id: "ana", liveFrameIds: ["a"] },
        { id: "ana", liveFrameIds: ["a"] },
        { id: "ben", liveFrameIds: ["b"] },
      ],
      choices: { joined: new Set(["a"]), left: new Set() },
    })
    expect(frames.get("a")?.on).toEqual([ME, "ana"])
    expect(frames.get("b")?.on).toEqual(["ben"])
  })

  it("drops someone off when their presence goes", () => {
    const before = rule({ others: [{ id: "ana", liveFrameIds: ["a"] }] })
    expect(before.get("a")?.live).toBe(true)
    const after = rule({ others: [] })
    expect(after.get("a")?.live).toBe(false)
  })

  it("keeps a frame live while the agent has control, with nobody on it", () => {
    const frames = rule({
      drivers: (id) => (id === "a" ? AGENT_PARTY : null),
    })
    expect(frames.get("a")).toEqual({
      live: true,
      on: [AGENT_PARTY],
      viewerOn: false,
    })
  })

  it("never makes a frame live that can't go live", () => {
    const frames = rule({
      frameIds: ["a"],
      others: [{ id: "ana", liveFrameIds: ["c"] }],
      choices: { joined: new Set(["c"]), left: new Set() },
    })
    expect(frames.has("c")).toBe(false)
  })
})

describe("landOnLiveFrames", () => {
  it("lands on frames already live when the canvas opens", () => {
    const frames = rule({ others: [{ id: "ana", liveFrameIds: ["a"] }] })
    expect(landOnLiveFrames(frames, NONE)).toEqual(["a"])
  })

  it("doesn't put back someone who left this session", () => {
    const choices = { joined: new Set<string>(), left: new Set(["a"]) }
    const frames = rule({
      others: [{ id: "ana", liveFrameIds: ["a"] }],
      choices,
    })
    expect(landOnLiveFrames(frames, choices)).toEqual([])
  })

  it("has nothing to land on while nobody is live", () => {
    expect(landOnLiveFrames(rule(), NONE)).toEqual([])
  })
})

describe("presenceLiveFrameIds", () => {
  it("lists the frames this viewer is on, in a stable order", () => {
    const frames = rule({
      frameIds: ["b", "a"],
      choices: { joined: new Set(["b", "a"]), left: new Set() },
    })
    expect(presenceLiveFrameIds(frames)).toEqual(["a", "b"])
  })
})
