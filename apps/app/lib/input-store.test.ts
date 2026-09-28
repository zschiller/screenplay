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
