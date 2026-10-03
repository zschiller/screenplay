import { describe, expect, it } from "vitest"

import {
  AGENT_PARTY,
  EMPTY_FRAME_CONTROL,
  FRAME_CONTROL_ACTIVE_STEP_MS,
  FRAME_CONTROL_GRACE_MS,
  FRAME_CONTROL_IDLE_MS,
  frameControlKey,
  frameDriverFor,
  drivenByOther,
  nextSettleAt,
  recordsLiveRoute,
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
    expect(record).toEqual({
      live: false,
      driver: "ana",
      requests: [],
      activeAt: 5,
    })
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

describe("a driver who leaves the frame alone", () => {
  const IDLE = FRAME_CONTROL_IDLE_MS
  // Ana took control at 0; Ben asked at 1000.
  const asked: FrameControlRecord = {
    live: true,
    driver: "ana",
    requests: [{ by: "ben", at: 1000 }],
    activeAt: 0,
  }
  const settle = (record: FrameControlRecord, now: number) =>
    reduceFrameControl(record, {
      type: "settle",
      now,
      presence: everyoneOnline,
    })

  it("keeps control while the request hasn't waited long enough", () => {
    expect(settle(asked, 1000 + IDLE - 1)).toBe(asked)
  })

  it("passes control to the asker once the request has waited idle", () => {
    const record = settle(asked, 1000 + IDLE)
    expect(record.driver).toBe("ben")
    expect(record.requests).toEqual([])
    expect(record.activeAt).toBe(1000 + IDLE)
  })

  it("counts the wait from the driver's last input", () => {
    const busy = reduceFrameControl(asked, {
      type: "active",
      by: "ana",
      at: 60_000,
    })
    expect(settle(busy, 1000 + IDLE).driver).toBe("ana")
    expect(settle(busy, 60_000 + IDLE).driver).toBe("ben")
  })

  it("passes to the oldest person asking, never to the agent", () => {
    const record = settle(
      {
        ...asked,
        requests: [
          { by: AGENT_PARTY, at: 10 },
          { by: "cara", at: 2000 },
          { by: "ben", at: 1000 },
        ],
      },
      2000 + IDLE
    )
    expect(record.driver).toBe("ben")
    expect(record.requests.map((r) => r.by)).toEqual([AGENT_PARTY, "cara"])
    expect(
      settle({ ...asked, requests: [{ by: AGENT_PARTY, at: 0 }] }, 10 * IDLE)
        .driver
    ).toBe("ana")
  })

  it("never hands the agent's control over: anyone takes it at once", () => {
    const record: FrameControlRecord = { ...asked, driver: AGENT_PARTY }
    expect(settle(record, 10 * IDLE)).toBe(record)
  })

  it("waits for the driver's clock when control changed hands without one", () => {
    const granted = run(
      [
        { type: "request", by: "cara", at: 500 },
        { type: "grant", by: "ana", to: "cara" },
      ],
      asked
    )
    expect(granted.driver).toBe("cara")
    expect(granted.activeAt).toBeUndefined()
    expect(settle(granted, 10 * IDLE).driver).toBe("cara")
    // Cara's client stamps it as soon as it sees she drives.
    const stamped = reduceFrameControl(granted, {
      type: "active",
      by: "cara",
      at: 5000,
    })
    expect(stamped.activeAt).toBe(5000)
    expect(settle(stamped, 5000 + IDLE).driver).toBe("ben")
  })

  it("moves the driver's clock in coarse steps, and only for the driver", () => {
    const step = FRAME_CONTROL_ACTIVE_STEP_MS
    expect(
      reduceFrameControl(asked, { type: "active", by: "ana", at: step - 1 })
    ).toBe(asked)
    expect(
      reduceFrameControl(asked, { type: "active", by: "ana", at: step })
        .activeAt
    ).toBe(step)
    expect(
      reduceFrameControl(asked, { type: "active", by: "ben", at: step })
    ).toBe(asked)
  })

  it("schedules the hand-off", () => {
    expect(nextSettleAt(asked, everyoneOnline)).toBe(1000 + IDLE)
    expect(
      nextSettleAt({ ...asked, activeAt: undefined }, everyoneOnline)
    ).toBeNull()
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

describe("who records where a live frame's page went", () => {
  it("is the person driving, not the people watching them", () => {
    expect(recordsLiveRoute({ kind: "you" })).toBe(true)
    expect(recordsLiveRoute({ kind: "person", id: "ana" })).toBe(false)
  })

  it("is every view while the agent drives, since it has no canvas", () => {
    expect(recordsLiveRoute({ kind: "agent" })).toBe(true)
  })

  it("is every view while nobody drives", () => {
    expect(recordsLiveRoute({ kind: "none" })).toBe(true)
  })
})
