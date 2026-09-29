// Two viewers of one frame, each in its own worker (its own copy of the
// package, its own `window`), with this thread playing the canvas: it keeps
// the room's state per key and fans each viewer's publish out to the others.
import assert from "node:assert/strict"
import { test } from "node:test"
import { Worker } from "node:worker_threads"

const viewer = new URL("./viewer.js", import.meta.url)

function startRoom(env, count) {
  const room = {}
  const viewers = []
  for (let i = 0; i < count; i++) {
    const worker = new Worker(viewer, {
      env: { ...process.env, NODE_ENV: env },
    })
    let seq = 0
    const pending = new Map()
    worker.on("message", (msg) => {
      if (
        msg.type === "post" &&
        msg.data.type === "screenplay:shared-state-request"
      ) {
        // A frame that loads asks for the room's state (#1000); answer it
        // the way the canvas does, so its first publish isn't held.
        worker.postMessage({
          type: "apply",
          data: {
            type: "screenplay:shared-state-apply",
            state: { ...room },
            initial: true,
          },
        })
      } else if (msg.type === "post") {
        Object.assign(room, msg.data.state)
        for (const other of viewers) {
          if (other.worker !== worker) {
            other.worker.postMessage({
              type: "apply",
              data: {
                type: "screenplay:shared-state-apply",
                state: msg.data.state,
              },
            })
          }
        }
      } else if (msg.type === "result") {
        pending.get(msg.id)?.(msg.value)
        pending.delete(msg.id)
      }
    })
    viewers.push({
      worker,
      call(action, ...args) {
        const id = ++seq
        worker.postMessage({ type: "call", id, action, args })
        return new Promise((resolve) => pending.set(id, resolve))
      },
    })
  }
  return {
    room,
    viewers,
    close: () => Promise.all(viewers.map((v) => v.worker.terminate())),
  }
}

// Lets posts cross between the workers and this thread.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

test("two viewers see each other's store changes and keep their actions", async () => {
  const { room, viewers, close } = startRoom("development", 2)
  const [a, b] = viewers
  try {
    await Promise.all(viewers.map((v) => v.call("ready")))
    await settle()

    await a.call("open", "Scale")
    await settle()
    assert.deepEqual(await b.call("data"), {
      contactOpen: true,
      plan: "Scale",
      seats: 5,
      updatedAt: "local Date",
    })

    // B's actions still work after a remote merge, and A sees the result.
    await b.call("setSeats", 12)
    await settle()
    assert.equal((await a.call("data")).seats, 12)
    await b.call("close")
    await settle()
    assert.equal((await a.call("data")).contactOpen, false)

    // Only the plain-JSON fields are published.
    assert.deepEqual(room.sales, {
      contactOpen: false,
      plan: "Scale",
      seats: 12,
    })
  } finally {
    await close()
  }
})

test("remote values never overwrite actions or fields JSON can't round-trip", async () => {
  const { viewers, close } = startRoom("development", 1)
  const [a] = viewers
  try {
    await a.call("ready")
    await a.call("remote", {
      sales: { seats: 30, open: "not a function", updatedAt: "2020-01-01" },
    })
    assert.deepEqual(await a.call("data"), {
      contactOpen: false,
      plan: "Growth",
      seats: 30,
      updatedAt: "local Date",
    })
    await a.call("open", "Starter")
    assert.equal((await a.call("data")).plan, "Starter")
  } finally {
    await close()
  }
})

test("does nothing outside development", async () => {
  const { room, viewers, close } = startRoom("production", 2)
  const [a, b] = viewers
  try {
    await Promise.all(viewers.map((v) => v.call("ready")))
    await a.call("open", "Scale")
    await settle()
    assert.deepEqual(room, {})
    assert.equal((await b.call("data")).plan, "Growth")
    assert.equal(await a.call("listeners"), 0)
  } finally {
    await close()
  }
})

test("stops sharing when the returned function is called", async () => {
  const { room, viewers, close } = startRoom("development", 2)
  const [a, b] = viewers
  try {
    await Promise.all(viewers.map((v) => v.call("ready")))
    await settle()
    await b.call("stop")
    await a.call("open", "Scale")
    await settle()
    assert.equal(room.sales.plan, "Scale")
    assert.equal((await b.call("data")).plan, "Growth")
  } finally {
    await close()
  }
})
