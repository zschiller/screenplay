import { describe, expect, it, vi } from "vitest"
import { inputStore } from "./input-store"

describe("inputStore.prefill", () => {
  it("holds text for a chat until its composer subscribes", () => {
    inputStore.prefill("chat-held", "Add a knob")
    const listener = vi.fn()
    const unsubscribe = inputStore.subscribe("chat-held", listener)
    expect(listener).toHaveBeenCalledWith("Add a knob")
    unsubscribe()
    // Delivered once: a later subscriber doesn't get it again.
    const later = vi.fn()
    inputStore.subscribe("chat-held", later)()
    expect(later).not.toHaveBeenCalled()
  })

  it("delivers straight away to a mounted composer", () => {
    const listener = vi.fn()
    const unsubscribe = inputStore.subscribe("chat-live", listener)
    inputStore.prefill("chat-live", "Add a knob")
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})

describe("inputStore.sendWhenOpen (#1644)", () => {
  it("holds a send until the chat subscribes, then sends it once", () => {
    inputStore.sendWhenOpen("chat-closed", "Names only")
    const listener = vi.fn()
    const unsubscribe = inputStore.subscribeSend("chat-closed", listener)
    expect(listener).toHaveBeenCalledWith("Names only")
    unsubscribe()
    const later = vi.fn()
    inputStore.subscribeSend("chat-closed", later)()
    expect(later).not.toHaveBeenCalled()
  })

  it("sends straight away to a mounted chat", () => {
    const listener = vi.fn()
    const unsubscribe = inputStore.subscribeSend("chat-open", listener)
    inputStore.sendWhenOpen("chat-open", "Names only")
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })
})
