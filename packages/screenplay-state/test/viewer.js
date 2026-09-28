// One viewer's frame for share-store.test.js: a fake iframed `window` whose
// posts go to the test thread (the canvas), plus the Northwind contact-sales
// store shared with `shareStore`.
import { parentPort } from "node:worker_threads"

const listeners = []
globalThis.window = {
  parent: {
    postMessage: (data) => parentPort.postMessage({ type: "post", data }),
  },
  addEventListener: (type, fn) => {
    if (type === "message") listeners.push(fn)
  },
}
const deliver = (data) => {
  for (const fn of listeners) fn({ data })
}

// The part of zustand's vanilla store that shareStore relies on.
function createStore(init) {
  let state
  const subscribers = new Set()
  const setState = (partial) => {
    const previous = state
    state = {
      ...state,
      ...(typeof partial === "function" ? partial(state) : partial),
    }
    for (const fn of subscribers) fn(state, previous)
  }
  const getState = () => state
  const subscribe = (fn) => {
    subscribers.add(fn)
    return () => subscribers.delete(fn)
  }
  state = init(setState)
  return { getState, setState, subscribe, subscribers }
}

const { shareStore } = await import("../index.js")

const updatedAt = new Date()
const sales = createStore((set) => ({
  contactOpen: false,
  plan: "Growth",
  seats: 5,
  updatedAt,
  open: (plan) => set({ contactOpen: true, plan }),
  close: () => set({ contactOpen: false }),
  setSeats: (seats) => set({ seats }),
}))
const stop = shareStore("sales", sales)

const data = () => {
  const out = {}
  for (const [k, v] of Object.entries(sales.getState())) {
    if (typeof v === "function") continue
    out[k] = v === updatedAt ? "local Date" : v
  }
  return out
}

const actions = {
  ready: () => true,
  data,
  listeners: () => sales.subscribers.size,
  stop: () => stop(),
  remote: (state) => deliver({ type: "screenplay:shared-state-apply", state }),
  open: (plan) => sales.getState().open(plan),
  close: () => sales.getState().close(),
  setSeats: (n) => sales.getState().setSeats(n),
}

parentPort.on("message", (msg) => {
  if (msg.type === "apply") deliver(msg.data)
  else if (msg.type === "call") {
    const value = actions[msg.action](...msg.args)
    parentPort.postMessage({ type: "result", id: msg.id, value: value ?? null })
  }
})
