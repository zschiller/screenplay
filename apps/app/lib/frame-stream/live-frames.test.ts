import { describe, expect, it } from "vitest"

import { AGENT_PARTY } from "@/lib/canvas/frame-control"
import { NOT_LIVE, liveFrames, mockupLiveWorkspace } from "./live-frames"

const FRAME = "frame-1"

function rule({
  turnedLive = [] as string[],
  viewerId = "zack" as string | null,
  others = [] as string[],
  agentOn = [] as string[],
} = {}) {
  return liveFrames({
    frameIds: [FRAME],
    turnedLive: (id) => turnedLive.includes(id),
    viewerId,
    others,
    drivers: (id) => (agentOn.includes(id) ? AGENT_PARTY : null),
  }).get(FRAME)
}

describe("liveFrames", () => {
  it("leaves frames as everyone's own copy until someone turns one live", () => {
    expect(rule({ others: ["ana"] })).toEqual(NOT_LIVE)
  })

  it("puts everyone on the canvas on a frame turned live", () => {
    expect(rule({ turnedLive: [FRAME], others: ["ana", "ben"] })).toEqual({
      live: true,
      on: ["zack", "ana", "ben"],
      viewerOn: true,
    })
  })

  it("counts each person once", () => {
    expect(
      rule({ turnedLive: [FRAME], others: ["zack", "ana", "ana"] })?.on
    ).toEqual(["zack", "ana"])
  })

  it("makes the frame live while the agent has control", () => {
    expect(rule({ agentOn: [FRAME], others: ["ana"] })).toEqual({
      live: true,
      on: ["zack", "ana", AGENT_PARTY],
      viewerOn: true,
    })
  })

  it("stays live with nobody here, so the next person lands on it", () => {
    expect(rule({ turnedLive: [FRAME], viewerId: null })).toEqual({
      live: true,
      on: [],
      viewerOn: true,
    })
  })

  it("only covers frames that can go live", () => {
    const frames = liveFrames({
      frameIds: [],
      turnedLive: () => true,
      viewerId: "zack",
      others: [],
      drivers: () => null,
    })
    expect(frames.get(FRAME)).toBeUndefined()
  })
})

describe("mockupLiveWorkspace", () => {
  const where = (
    over: Partial<Parameters<typeof mockupLiveWorkspace>[0]> = {}
  ) =>
    mockupLiveWorkspace({
      live: false,
      liveBranchId: undefined,
      ownerBranchId: undefined,
      streaming: ["ws-b", "ws-a"],
      ...over,
    })

  it("goes live in the owning chat's Workspace when it's running", () => {
    expect(where({ ownerBranchId: "ws-b" })).toBe("ws-b")
  })

  it("borrows the first running Workspace otherwise", () => {
    expect(where()).toBe("ws-a")
    expect(where({ ownerBranchId: "ws-gone" })).toBe("ws-a")
  })

  it("stays in the Workspace it went live in", () => {
    expect(
      where({ live: true, liveBranchId: "ws-b", ownerBranchId: "ws-a" })
    ).toBe("ws-b")
  })

  it("offers another Workspace when the one it was live in stopped", () => {
    expect(
      where({ live: true, liveBranchId: "ws-gone", ownerBranchId: "ws-b" })
    ).toBe("ws-b")
  })

  it("has nowhere to go live with no Workspace running", () => {
    expect(where({ streaming: [], ownerBranchId: "ws-a" })).toBeUndefined()
  })
})
