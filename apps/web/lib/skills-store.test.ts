import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { getSkillMenuItems } from "@/lib/skills-store"
import type { SkillsResponse } from "@/app/api/agent/skills/route"

function jsonResponse(body: SkillsResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

const repoItem = {
  name: "deploy",
  description: "Repo deploy.",
  origin: "repo" as const,
}
const appItem = {
  name: "knobs",
  description: "App knobs.",
  origin: "app" as const,
}

describe("getSkillMenuItems", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("requests the per-sandbox merged index and returns its skills", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ skills: [repoItem, appItem] }))
    vi.stubGlobal("fetch", fetchMock)

    const skills = await getSkillMenuItems("sbx-1")

    expect(fetchMock).toHaveBeenCalledWith("/api/agent/skills?sandbox=sbx-1")
    expect(skills).toEqual([repoItem, appItem])
  })

  it("falls back to the App-only endpoint with no sandbox", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ skills: [appItem] }))
    vi.stubGlobal("fetch", fetchMock)

    await getSkillMenuItems()

    expect(fetchMock).toHaveBeenCalledWith("/api/agent/skills")
  })

  it("de-dupes concurrent calls for the same sandbox into one request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ skills: [appItem] }))
    vi.stubGlobal("fetch", fetchMock)

    await Promise.all([getSkillMenuItems("sbx-1"), getSkillMenuItems("sbx-1")])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("does not cache across opens, so reopening refetches the list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ skills: [appItem] }))
      .mockResolvedValueOnce(jsonResponse({ skills: [repoItem, appItem] }))
    vi.stubGlobal("fetch", fetchMock)

    const first = await getSkillMenuItems("sbx-1")
    const second = await getSkillMenuItems("sbx-1")

    expect(first).toEqual([appItem])
    expect(second).toEqual([repoItem, appItem])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
