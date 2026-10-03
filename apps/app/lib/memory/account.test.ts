import { describe, expect, it } from "vitest"
import {
  addAccountMemory,
  editAccountMemory,
  inMemoryAccountMemoryStore,
  readAccountMemory,
  removeAccountMemory,
} from "./account"
import { MEMORY_ENTRY_MAX_LENGTH, memorySource } from "./entry"

describe("account memory (#1513)", () => {
  it("adds entries and reads them oldest first", async () => {
    const store = inMemoryAccountMemoryStore()
    await addAccountMemory(store, { text: "Second.", source: "agent", now: 2 })
    await addAccountMemory(store, { text: "First.", source: "member", now: 1 })

    expect((await readAccountMemory(store)).map((m) => m.text)).toEqual([
      "First.",
      "Second.",
    ])
  })

  it("trims and caps an entry like canvas memory, and refuses empty text", async () => {
    const store = inMemoryAccountMemoryStore()
    const entry = await addAccountMemory(store, {
      text: `  ${"x".repeat(MEMORY_ENTRY_MAX_LENGTH + 10)}  `,
      source: "member",
    })
    expect(entry!.text).toHaveLength(MEMORY_ENTRY_MAX_LENGTH)
    expect(
      await addAccountMemory(store, { text: "   ", source: "member" })
    ).toBeNull()
    expect(await readAccountMemory(store)).toHaveLength(1)
  })

  it("edits an entry's text by id", async () => {
    const store = inMemoryAccountMemoryStore()
    const entry = await addAccountMemory(store, {
      text: "Use npm.",
      source: "agent",
      now: 1,
    })
    expect(
      await editAccountMemory(store, entry!.id, { text: "Use pnpm.", now: 5 })
    ).toBe(true)
    expect(await readAccountMemory(store)).toEqual([
      { ...entry, text: "Use pnpm.", updatedAt: 5 },
    ])
    expect(await editAccountMemory(store, "mem-gone", { text: "x" })).toBe(
      false
    )
  })

  it("removes an entry by id", async () => {
    const store = inMemoryAccountMemoryStore()
    const entry = await addAccountMemory(store, {
      text: "Forget me.",
      source: "member",
    })
    expect(await removeAccountMemory(store, entry!.id)).toBe(true)
    expect(await readAccountMemory(store)).toEqual([])
    expect(await removeAccountMemory(store, entry!.id)).toBe(false)
  })
})

describe("memorySource", () => {
  it("reads entries the Coordinator saved before #1513 as an agent's", () => {
    expect(memorySource({ source: "coordinator" })).toBe("agent")
    expect(memorySource({ source: "agent" })).toBe("agent")
    expect(memorySource({ source: "member" })).toBe("member")
  })
})
