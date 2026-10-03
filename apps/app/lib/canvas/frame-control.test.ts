import { describe, expect, it } from "vitest"

import {
  AGENT_PARTY,
  EMPTY_FRAME_CONTROL,
  FRAME_CONTROL_GRACE_MS,
  frameControlKey,
  frameDriverFor,
  drivenByOther,
  nextSettleAt,
  reduceFrameControl,
  type FrameControlAction,
  type FrameControlPresence,
  type FrameControlRecord,
} from "@/lib/canvas/frame-control"

const everyoneOnline: FrameControlPresence = {
  online: new Set(["ana", "ben", "cara"]),
  goneAt: new Map(),
}

function presence(
  online: string[],
  goneAt: Record<string, number> = {}
): FrameControlPresence {
  return { online: new Set(online), goneAt: new Map(Object.entries(goneAt)) }
}

function run(
  actions: FrameControlAction[],
  from: FrameControlRecord = EMPTY_FRAME_CONTROL
): FrameControlRecord {
  return actions.reduce(reduceFrameControl, from)
}

const driving = (driver: string | null, requests: string[] = []) => ({
  live: false,
  driver,
  requests: requests.map((by, i) => ({ by, at: i })),
})

describe("picking up a frame nobody drives", () => {
  it("lets anyone pick it up", () => {
    expect(run([{ type: "request", by: "ana", at: 0 }]).driver).toBe("ana")
  })

  it("lets the agent pick it up too", () => {
    expect(run([{ type: "request", by: AGENT_PARTY, at: 0 }]).driver).toBe(
      AGENT_PARTY
    )
  })

  it("does nothing when the driver asks again", () => {
    const record = driving("ana")
    expect(
      reduceFrameControl(record, { type: "request", by: "ana", at: 1 })
    ).toBe(record)
  })
})

describe("between people, the driver lets you drive", () => {
  it("queues a request instead of handing over", () => {
    const record = run([{ type: "request", by: "ben", at: 1 }], driving("ana"))
    expect(record).toEqual({
      live: false,
      driver: "ana",
      requests: [{ by: "ben", at: 1 }],
    })
  })

  it("hands over on Give control", () => {
    const record = run(
      [
        { type: "request", by: "ben", at: 1 },
        { type: "grant", by: "ana", to: "ben" },
      ],
      driving("ana")
    )
    expect(record.driver).toBe("ben")
    expect(record.requests).toEqual([])
  })

  it("drops the request on Not now and keeps the driver", () => {
    const record = run(
      [
        { type: "request", by: "ben", at: 1 },
        { type: "decline", by: "ana", to: "ben" },
      ],
      driving("ana")
    )
    expect(record).toEqual({ live: false, driver: "ana", requests: [] })
  })

  it("only lets the driver grant or decline", () => {
    const record = driving("ana", ["ben"])
    expect(
      reduceFrameControl(record, { type: "grant", by: "cara", to: "ben" })
    ).toBe(record)
    expect(
      reduceFrameControl(record, { type: "decline", by: "cara", to: "ben" })
    ).toBe(record)
  })

  it("can't grant someone who never asked", () => {
    const record = driving("ana")
    expect(
      reduceFrameControl(record, { type: "grant", by: "ana", to: "ben" })
    ).toBe(record)
  })

  it("lets a requester withdraw", () => {
    const record = run([{ type: "cancel", by: "ben" }], driving("ana", ["ben"]))
    expect(record.requests).toEqual([])
  })
})

describe("simultaneous requests queue", () => {
  it("keeps both, and the driver picks one", () => {
    const asked = run(
      [
        { type: "request", by: "ben", at: 1 },
        { type: "request", by: "cara", at: 1 },
      ],
      driving("ana")
    )
    expect(asked.requests.map((r) => r.by)).toEqual(["ben", "cara"])

    const picked = reduceFrameControl(asked, {
      type: "grant",
      by: "ana",
      to: "cara",
    })
    expect(picked.driver).toBe("cara")
    expect(picked.requests).toEqual([{ by: "ben", at: 1 }])
  })

  it("doesn't queue the same person twice", () => {
    const record = run(
      [
        { type: "request", by: "ben", at: 1 },
        { type: "request", by: "ben", at: 2 },
      ],
      driving("ana")
    )
    expect(record.requests).toEqual([{ by: "ben", at: 1 }])
  })
})

describe("a driver who leaves", () => {
  const anaLeftAt = 100

  it("keeps control for the grace period, so a reload is harmless", () => {
    const record = run(
      [
        {
          type: "settle",
          now: anaLeftAt + FRAME_CONTROL_GRACE_MS - 1,
          presence: presence(["ben"], { ana: anaLeftAt }),
        },
      ],
      driving("ana", ["ben"])
    )
    expect(record.driver).toBe("ana")
  })

  it("keeps control when back within the grace period", () => {
    const record = run(
      [
        {
          type: "settle",
          now: anaLeftAt + FRAME_CONTROL_GRACE_MS * 2,
          presence: presence(["ana", "ben"]),
        },
      ],
      driving("ana", ["ben"])
    )
    expect(record.driver).toBe("ana")
  })

  it("passes control to the oldest online requester after it", () => {
    const record = run(
      [
        { type: "request", by: "cara", at: 2 },
        { type: "request", by: "ben", at: 3 },
        {
          type: "settle",
          now: anaLeftAt + FRAME_CONTROL_GRACE_MS,
          presence: presence(["ben", "cara"], { ana: anaLeftAt }),
        },
      ],
      driving("ana")
    )
    expect(record.driver).toBe("cara")
    expect(record.requests).toEqual([{ by: "ben", at: 3 }])
  })

  it("skips a requester who is offline but still within their own grace", () => {
    const record = run(
      [
        { type: "request", by: "cara", at: 2 },
        { type: "request", by: "ben", at: 3 },
        {
          type: "settle",
          now: anaLeftAt + FRAME_CONTROL_GRACE_MS,
          presence: presence(["ben"], {
            ana: anaLeftAt,
            cara: anaLeftAt + FRAME_CONTROL_GRACE_MS - 10,
          }),
        },
      ],
      driving("ana")
    )
    expect(record.driver).toBe("ben")
    expect(record.requests).toEqual([{ by: "cara", at: 2 }])
  })

  it("passes control to nobody when no one asked", () => {
    const record = run(
      [
        {
          type: "settle",
          now: anaLeftAt + FRAME_CONTROL_GRACE_MS,
          presence: presence(["ben"], { ana: anaLeftAt }),
        },
      ],
      driving("ana")
    )
    expect(record.driver).toBeNull()
  })

  it("then lets anyone pick the frame up", () => {
    const record = run(
      [
        {
          type: "settle",
          now: anaLeftAt + FRAME_CONTROL_GRACE_MS,
          presence: presence(["ben"], { ana: anaLeftAt }),
        },
        { type: "request", by: "ben", at: anaLeftAt + FRAME_CONTROL_GRACE_MS },
      ],
      driving("ana")
    )
    expect(record.driver).toBe("ben")
  })

  it("counts someone offline with no known leave time as gone", () => {
    const record = run(
      [{ type: "settle", now: 0, presence: presence(["ben"]) }],
      driving("ana", ["ben"])
    )
    expect(record.driver).toBe("ben")
  })
})

describe("requests from people who left", () => {
  it("are dropped once their grace runs out", () => {
    const record = run(
      [
        {
          type: "settle",
          now: 10 + FRAME_CONTROL_GRACE_MS,
          presence: presence(["ana"], { ben: 10 }),
        },
      ],
      driving("ana", ["ben", "cara"])
    )
    expect(record.requests.map((r) => r.by)).toEqual([])
  })

  it("survive a reload", () => {
    const record = driving("ana", ["ben"])
    expect(
      reduceFrameControl(record, {
        type: "settle",
        now: 10 + FRAME_CONTROL_GRACE_MS - 1,
        presence: presence(["ana"], { ben: 10 }),
      })
    ).toBe(record)
  })
})

describe("the driver stops driving", () => {
  it("hands over to the oldest online requester", () => {
    const record = run(
      [{ type: "release", by: "ana", presence: everyoneOnline }],
      driving("ana", ["cara", "ben"])
    )
    expect(record.driver).toBe("cara")
  })

  it("leaves the frame to nobody when no one asked", () => {
    const record = run(
      [{ type: "release", by: "ana", presence: everyoneOnline }],
      driving("ana")
    )
    expect(record.driver).toBeNull()
  })

  it("is ignored from anyone but the driver", () => {
    const record = driving("ana")
    expect(
      reduceFrameControl(record, {
        type: "release",
        by: "ben",
        presence: everyoneOnline,
      })
    ).toBe(record)
  })
})

describe("the agent always yields", () => {
  it("gives control to a person at once, with no request", () => {
    const record = run(
      [{ type: "request", by: "ana", at: 5 }],
      driving(AGENT_PARTY)
    )
    expect(record).toEqual({ live: false, driver: "ana", requests: [] })
  })

  it("asks through the same gate as people", () => {
    const record = run(
      [{ type: "request", by: AGENT_PARTY, at: 5 }],
      driving("ana")
    )
    expect(record.driver).toBe("ana")
    expect(record.requests).toEqual([{ by: AGENT_PARTY, at: 5 }])
  })

  it("waits after a take-over, asks again, and drives once let", () => {
    const record = run(
      [
        { type: "request", by: "ana", at: 5 },
        { type: "request", by: AGENT_PARTY, at: 6 },
        { type: "release", by: "ana", presence: presence(["ana"]) },
      ],
      driving(AGENT_PARTY)
    )
    expect(record.driver).toBe(AGENT_PARTY)
    expect(record.requests).toEqual([])
  })

  it("is always online, so its request outlives any grace", () => {
    const record = run(
      [
        {
          type: "settle",
          now: 10 * FRAME_CONTROL_GRACE_MS,
          presence: presence([], { ana: 0 }),
        },
      ],
      driving("ana", [AGENT_PARTY])
    )
    expect(record.driver).toBe(AGENT_PARTY)
  })
})

describe("asking the agent in chat to show you something", () => {
  it("grants it control when nobody drives", () => {
    expect(run([{ type: "chat-ask", asker: "ana", at: 1 }]).driver).toBe(
      AGENT_PARTY
    )
  })

  it("grants it control when the asker drives", () => {
    const record = run(
      [{ type: "chat-ask", asker: "ana", at: 1 }],
      driving("ana")
    )
    expect(record).toEqual({ live: false, driver: AGENT_PARTY, requests: [] })
  })

  it("only queues the agent's ask when someone else drives", () => {
    const record = run(
      [{ type: "chat-ask", asker: "ben", at: 1 }],
      driving("ana")
    )
    expect(record.driver).toBe("ana")
    expect(record.requests).toEqual([{ by: AGENT_PARTY, at: 1 }])
  })

  it("leaves an agent that already drives alone", () => {
    const record = driving(AGENT_PARTY)
    expect(
      reduceFrameControl(record, { type: "chat-ask", asker: "ana", at: 1 })
    ).toBe(record)
  })
})

describe("nextSettleAt", () => {
  it("is null while everyone involved is online", () => {
    expect(nextSettleAt(driving("ana", ["ben"]), everyoneOnline)).toBeNull()
  })

  it("is when the first gone party runs out of grace", () => {
    expect(
      nextSettleAt(
        driving("ana", ["ben"]),
        presence(["cara"], { ana: 100, ben: 50 })
      )
    ).toBe(50 + FRAME_CONTROL_GRACE_MS)
  })

  it("is now for someone gone with no known leave time", () => {
    expect(nextSettleAt(driving("ana"), presence([]))).toBe(0)
  })

  it("never waits on the agent", () => {
    expect(nextSettleAt(driving(AGENT_PARTY), presence([]))).toBeNull()
  })
})

describe("frameDriverFor", () => {
  it("reads nobody from a missing record", () => {
    expect(frameDriverFor(undefined, "ana")).toEqual({ kind: "none" })
  })

  it("tells the viewer apart from the agent and other people", () => {
    expect(frameDriverFor(driving("ana"), "ana")).toEqual({ kind: "you" })
    expect(frameDriverFor(driving(AGENT_PARTY), "ana")).toEqual({
      kind: "agent",
    })
    expect(frameDriverFor(driving("ben"), "ana")).toEqual({
      kind: "person",
      id: "ben",
    })
  })

  it("marks only someone else driving as driven by another", () => {
    expect(drivenByOther({ kind: "none" })).toBe(false)
    expect(drivenByOther({ kind: "you" })).toBe(false)
    expect(drivenByOther({ kind: "agent" })).toBe(true)
    expect(drivenByOther({ kind: "person", id: "ben" })).toBe(true)
  })
})

describe("frameControlKey", () => {
  it("gives each viewer's copy of a frame its own record", () => {
    expect(frameControlKey("frame-1", "ana")).not.toBe(
      frameControlKey("frame-1", "ben")
    )
  })
})
