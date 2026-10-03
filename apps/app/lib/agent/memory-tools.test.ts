import { describe, expect, it } from "vitest"

import { buildMemoryTools } from "@/lib/agent/memory-tools"
import {
  inMemoryAccountMemoryStore,
  readAccountMemory,
  type AccountMemoryStore,
} from "@/lib/memory/account"
import { readMemory } from "@/lib/memory/canvas"
import type { RoomCollections } from "@/lib/yjs/schema"
import { makeHarness } from "@/test/canvas/harness"

/**
 * `write_memory` (#1515) over fake ports: canvas memory in a bare Room doc,
 * account memory in an in-memory store standing in for the sender's.
 */
function setup(
  account: AccountMemoryStore | null = inMemoryAccountMemoryStore()
) {
  const { collections } = makeHarness()
  const tools = buildMemoryTools({
    canvas: { mutateDoc: async (fn) => fn(collections) },
    account,
  })
  const write = async (input: Record<string, unknown>) =>
    (await tools.write_memory.execute!(input as never, {
      toolCallId: "t1",
      messages: [],
      context: {},
    })) as string
  return { collections, account, write }
}

const canvasTexts = (c: RoomCollections) => readMemory(c).map((m) => m.text)

describe("write_memory, canvas scope", () => {
  it("adds an entry to the Room’s shared data, marked as an agent’s", async () => {
    const { collections, account, write } = setup()
    const out = await write({
      scope: "canvas",
      action: "add",
      text: "  Use pnpm, never npm.  ",
    })

    const [entry, ...rest] = readMemory(collections)
    expect(rest).toEqual([])
    expect(entry).toMatchObject({
      text: "Use pnpm, never npm.",
      source: "agent",
    })
    expect(out).toBe(
      `Saved to canvas memory: [${entry!.id}] Use pnpm, never npm.`
    )
    expect(await readAccountMemory(account!)).toEqual([])
  })

  it("edits and removes an entry by id", async () => {
    const { collections, write } = setup()
    await write({ scope: "canvas", action: "add", text: "Deploy on Fridays." })
    const id = readMemory(collections)[0]!.id

    expect(
      await write({
        scope: "canvas",
        action: "edit",
        id,
        text: "Never deploy on Fridays.",
      })
    ).toBe(`Updated [${id}] in canvas memory.`)
    expect(canvasTexts(collections)).toEqual(["Never deploy on Fridays."])

    expect(await write({ scope: "canvas", action: "remove", id })).toBe(
      `Removed [${id}] from canvas memory.`
    )
    expect(readMemory(collections)).toEqual([])
  })

  it("writes canvas memory when a harness leaves the scope out", async () => {
    const { collections, write } = setup()
    await write({ action: "add", text: "Staging is flaky." })
    expect(canvasTexts(collections)).toEqual(["Staging is flaky."])
  })

  it("changes nothing for an unknown id or empty text", async () => {
    const { collections, write } = setup()
    expect(
      await write({ scope: "canvas", action: "edit", id: "mem-x", text: "hi" })
    ).toBe("No canvas memory entry [mem-x].")
    expect(await write({ scope: "canvas", action: "remove" })).toMatch(
      /needs the entry’s id/
    )
    expect(
      await write({ scope: "canvas", action: "add", text: "   " })
    ).toMatch(/needs text/)
    expect(readMemory(collections)).toEqual([])
  })
})

describe("write_memory, account scope", () => {
  it("adds, edits and removes the sender’s entries, never the canvas’s", async () => {
    const { collections, account, write } = setup()

    const added = await write({
      scope: "account",
      action: "add",
      text: "Prefers plain UI copy.",
    })
    const [entry] = await readAccountMemory(account!)
    expect(entry).toMatchObject({
      text: "Prefers plain UI copy.",
      source: "agent",
    })
    expect(added).toBe(
      `Saved to account memory: [${entry!.id}] Prefers plain UI copy.`
    )
    expect(readMemory(collections)).toEqual([])

    expect(
      await write({
        scope: "account",
        action: "edit",
        id: entry!.id,
        text: "Prefers small fixes over redesigns.",
      })
    ).toBe(`Updated [${entry!.id}] in account memory.`)
    expect((await readAccountMemory(account!)).map((m) => m.text)).toEqual([
      "Prefers small fixes over redesigns.",
    ])

    expect(
      await write({ scope: "account", action: "remove", id: entry!.id })
    ).toBe(`Removed [${entry!.id}] from account memory.`)
    expect(await readAccountMemory(account!)).toEqual([])
  })

  it("doesn’t reach a canvas entry by id", async () => {
    const { collections, write } = setup()
    await write({ scope: "canvas", action: "add", text: "Use pnpm." })
    const id = readMemory(collections)[0]!.id

    expect(await write({ scope: "account", action: "remove", id })).toBe(
      `No account memory entry [${id}].`
    )
    expect(canvasTexts(collections)).toEqual(["Use pnpm."])
  })

  it("refuses account writes on a turn nobody sent", async () => {
    const { collections, write } = setup(null)

    const out = await write({
      scope: "account",
      action: "add",
      text: "Prefers plain UI copy.",
    })

    expect(out).toMatch(/nobody sent this turn/)
    expect(readMemory(collections)).toEqual([])
    // Canvas memory still works on such a turn.
    await write({ scope: "canvas", action: "add", text: "Use pnpm." })
    expect(canvasTexts(collections)).toEqual(["Use pnpm."])
  })
})
