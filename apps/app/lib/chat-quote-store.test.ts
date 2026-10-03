import { describe, expect, it, vi } from "vitest"
import {
  chatQuoteStore,
  quoteRangeLabel,
  type ChatQuote,
} from "./chat-quote-store"

const quote = (text: string, lineFrom = 3, lineTo = 4): ChatQuote => ({
  documentId: "doc-1",
  documentTitle: "Launch plan",
  quotedText: text,
  lineFrom,
  lineTo,
})

describe("chatQuoteStore", () => {
  it("quotes into the chat that came to the foreground last", () => {
    const leaveRoom = chatQuoteStore.claimForeground("room")
    const leaveTab = chatQuoteStore.claimForeground("tab")
    const listener = vi.fn()
    const unsubscribe = chatQuoteStore.subscribe("tab", listener)

    expect(chatQuoteStore.reply(quote("Ship on Friday"))).toBe("tab")
    expect(listener).toHaveBeenCalledTimes(1)
    expect(chatQuoteStore.get("tab")?.quotedText).toBe("Ship on Friday")
    expect(chatQuoteStore.get("room")).toBeUndefined()

    // The tab leaves the screen: the next reply goes to the chat under it.
    leaveTab()
    expect(chatQuoteStore.reply(quote("Pricing"))).toBe("room")

    unsubscribe()
    leaveRoom()
    chatQuoteStore.remove("tab")
    chatQuoteStore.remove("room")
  })

  it("replaces a chat's quote with a second reply, under a new key", () => {
    const leave = chatQuoteStore.claimForeground("chat-a")
    chatQuoteStore.reply(quote("First"))
    const first = chatQuoteStore.get("chat-a")!
    chatQuoteStore.reply(quote("Second"))
    const second = chatQuoteStore.get("chat-a")!
    expect(second.quotedText).toBe("Second")
    expect(second.key).not.toBe(first.key)
    leave()
    chatQuoteStore.remove("chat-a")
  })

  it("holds a reply until a chat comes to the foreground", () => {
    expect(chatQuoteStore.reply(quote("Held"))).toBeNull()
    const leave = chatQuoteStore.claimForeground("chat-b")
    expect(chatQuoteStore.get("chat-b")?.quotedText).toBe("Held")
    leave()
    // Claimed once: another chat doesn't get it again.
    const leaveC = chatQuoteStore.claimForeground("chat-c")
    expect(chatQuoteStore.get("chat-c")).toBeUndefined()
    leaveC()
    chatQuoteStore.remove("chat-b")
  })

  it("clears the quote a send takes, and one its X removes", () => {
    const leave = chatQuoteStore.claimForeground("chat-d")
    chatQuoteStore.reply(quote("Take me"))
    expect(chatQuoteStore.take("chat-d")?.quotedText).toBe("Take me")
    expect(chatQuoteStore.take("chat-d")).toBeUndefined()

    chatQuoteStore.reply(quote("Remove me"))
    const listener = vi.fn()
    const unsubscribe = chatQuoteStore.subscribe("chat-d", listener)
    chatQuoteStore.remove("chat-d")
    expect(chatQuoteStore.get("chat-d")).toBeUndefined()
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    leave()
  })
})

describe("quoteRangeLabel", () => {
  it("names one line or a range", () => {
    expect(quoteRangeLabel({ lineFrom: 2, lineTo: 2 })).toBe("Line 2")
    expect(quoteRangeLabel({ lineFrom: 2, lineTo: 5 })).toBe("Lines 2–5")
  })
})
