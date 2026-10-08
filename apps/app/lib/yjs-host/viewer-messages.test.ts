import { describe, expect, it } from "vitest"
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness"
import * as Y from "yjs"

import { viewerMessageFilter } from "@/lib/yjs-host/viewer-messages"

const ANA = { id: "tailscale:ana@example.com", name: "Ana" }

/** y-websocket's framing: a varUint type, then the payload. */
function frame(type: number, payload: number[] | Uint8Array): Uint8Array {
  return Uint8Array.from([type, ...varUint(payload.length), ...payload])
}

function varUint(n: number): number[] {
  const out: number[] = []
  while (n > 0x7f) {
    out.push(0x80 | (n % 128))
    n = Math.floor(n / 128)
  }
  out.push(n)
  return out
}

/** An awareness message from a client with `clientId` and `state`. */
function awareness(
  clientId: number,
  state: Record<string, unknown> | null
): Uint8Array {
  const doc = new Y.Doc()
  doc.clientID = clientId
  const a = new Awareness(doc)
  a.setLocalState(state)
  const message = frame(1, encodeAwarenessUpdate(a, [clientId]))
  a.destroy()
  doc.destroy()
  return message
}

/** The states a filtered awareness message carries, by client id. */
function statesOf(message: Uint8Array | null): Map<number, unknown> {
  expect(message).not.toBeNull()
  const doc = new Y.Doc()
  const a = new Awareness(doc)
  // The update, without the type and length framing it.
  const update = message!.subarray(1 + varUint(message!.length - 1).length)
  applyAwarenessUpdate(a, update, null)
  const states = new Map(a.getStates())
  states.delete(doc.clientID)
  a.destroy()
  doc.destroy()
  return states
}

describe("what a viewer's socket passes on", () => {
  const filter = () =>
    viewerMessageFilter({ person: ANA, heldElsewhere: (id) => id === 7 })

  it("passes sync step 1 and drops sync step 2 and updates", () => {
    const f = filter()
    const step1 = Uint8Array.from([0, 0, 1, 0])
    expect(f(step1)).toBe(step1)
    expect(f(Uint8Array.from([0, 1, 2, 0, 0]))).toBeNull()
    expect(f(Uint8Array.from([0, 2, 2, 0, 0]))).toBeNull()
  })

  it("drops other message types and garbage", () => {
    const f = filter()
    expect(f(Uint8Array.from([2, 0]))).toBeNull()
    expect(f(Uint8Array.from([3]))).toBeNull()
    expect(f(Uint8Array.from([1, 9, 1]))).toBeNull()
    expect(f(Uint8Array.from([]))).toBeNull()
  })

  it("names the viewer as the identity did and marks them a viewer", () => {
    const states = statesOf(
      filter()(
        awareness(42, {
          identity: { id: "boss", name: "The boss" },
          color: "#fff",
          viewer: false,
        })
      )
    )
    expect(states.get(42)).toEqual({
      identity: { id: ANA.id, name: ANA.name },
      color: "#fff",
      viewer: true,
    })
  })

  it("gives a state with no identity yet none", () => {
    const states = statesOf(
      filter()(awareness(42, { selectedIframeLayerIds: [] }))
    )
    expect(states.get(42)).toEqual({ selectedIframeLayerIds: [], viewer: true })
  })

  it("speaks for one client only, never one another socket holds", () => {
    const f = filter()
    expect(f(awareness(7, { identity: { id: "x", name: "Host" } }))).toBeNull()
    expect(statesOf(f(awareness(42, { identity: {} })))).toHaveProperty(
      "size",
      1
    )
    expect(f(awareness(43, { identity: {} }))).toBeNull()
  })
})
