import { describe, expect, it } from "vitest"

import { SHARING_OFF_CLOSE_CODE } from "@/server/ws-routes.mjs"

import {
  type HostAway,
  type SocketEvent,
  hostAwayMessage,
  nextHostAway,
} from "./host-away"

function run(events: SocketEvent[], from: HostAway = null): HostAway {
  return events.reduce(nextHostAway, from)
}

const offClose: SocketEvent = { type: "close", code: SHARING_OFF_CLOSE_CODE }
const dropped: SocketEvent = { type: "close", code: 1006 }
const disconnected: SocketEvent = { type: "status", status: "disconnected" }
const connecting: SocketEvent = { type: "status", status: "connecting" }
const connected: SocketEvent = { type: "status", status: "connected" }

describe("a viewer whose host goes away", () => {
  it("sees the host stopped sharing when Sharing turns off", () => {
    expect(run([offClose, disconnected])).toBe("stopped")
  })

  it("keeps seeing it through the reconnects that fail while it’s off", () => {
    expect(
      run([offClose, disconnected, connecting, dropped, disconnected])
    ).toBe("stopped")
  })

  it("sees the host’s Mac can’t be reached when the socket drops", () => {
    expect(run([dropped, disconnected])).toBe("unreachable")
  })

  it("recovers once the canvas socket connects again", () => {
    expect(run([offClose, disconnected, connecting, connected])).toBeNull()
    expect(run([dropped, disconnected, connecting, connected])).toBeNull()
  })

  it("names the host when it knows them", () => {
    expect(hostAwayMessage("stopped", "Maya Chen")).toBe(
      "Maya Chen stopped sharing. This page comes back when they share again."
    )
    expect(hostAwayMessage("unreachable", "Maya Chen")).toBe(
      "Can’t reach Maya Chen’s Mac. Trying again…"
    )
    expect(hostAwayMessage("unreachable", null)).toBe(
      "Can’t reach the host’s Mac. Trying again…"
    )
  })
})
