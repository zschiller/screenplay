import { describe, expect, it } from "vitest"
import type { BranchData, ChatSessionData } from "@/lib/types"
import { workingChatsOf } from "./working-chat"

const branch = {
  id: "ws-1",
  ref: "checkout-polish",
  title: "Checkout polish",
} as BranchData

const chat = (c: Partial<ChatSessionData>): ChatSessionData => ({
  id: "c",
  label: "Chat",
  createdAt: 0,
  ...c,
})

describe("workingChatsOf (#1726)", () => {
  it.each([
    [
      "a Workspace's chat by its Workspace",
      chat({ id: "a", branchId: "ws-1", label: "Chat 2" }),
      { chatId: "a", label: "Checkout polish", branchId: "ws-1" },
    ],
    [
      "a chat with no repository by its own label",
      chat({ id: "s", target: "sketch", label: "Receipt ideas" }),
      { chatId: "s", label: "Receipt ideas" },
    ],
    [
      "a chat whose Workspace is gone by its own label",
      chat({ id: "g", branchId: "ws-gone", label: "Old chat" }),
      { chatId: "g", label: "Old chat" },
    ],
  ])("names %s", (_, holder, expected) => {
    expect(workingChatsOf(new Map([["m", holder]]), [branch])).toEqual(
      new Map([["m", expected]])
    )
  })
})
