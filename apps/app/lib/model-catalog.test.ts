import { describe, expect, it } from "vitest"
import {
  createModelCatalog,
  inMemoryCatalogSource,
  resolveModels,
} from "@/lib/model-catalog"
import type { ModelInfo } from "@/lib/models-store"

function model(id: string): ModelInfo {
  return {
    id,
    label: id,
    provider: { key: "claude-code", label: "Claude Code" },
  }
}

const opus = model("claude-code:opus")
const sonnet = model("claude-code:sonnet")

/** Let the catalog's fetch settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("model catalog", () => {
  it("starts idle and loads once, however many callers ask", async () => {
    const source = inMemoryCatalogSource({ models: [opus] })
    const catalog = createModelCatalog(source)
    expect(catalog.getState().status).toBe("idle")

    catalog.load()
    catalog.load()
    expect(catalog.getState().status).toBe("loading")
    await settle()
    catalog.load()

    expect(catalog.getState()).toMatchObject({
      status: "loaded",
      models: [opus],
    })
    expect(source.modelLoads).toBe(1)
  })

  it("an empty catalog is loaded with no agents, not loading", async () => {
    const catalog = createModelCatalog(inMemoryCatalogSource({ models: [] }))
    catalog.load()
    await settle()

    const state = catalog.getState()
    expect(state.status).toBe("loaded")
    expect(resolveModels(state, {}).noAgents).toBe(true)
  })

  it("a failed fetch is failed, not empty, and retry loads it", async () => {
    const source = inMemoryCatalogSource({ models: [opus], failures: 1 })
    const catalog = createModelCatalog(source)
    catalog.load()
    await settle()

    expect(catalog.getState().status).toBe("failed")
    expect(resolveModels(catalog.getState(), {}).noAgents).toBe(false)

    catalog.retry()
    expect(catalog.getState().status).toBe("loading")
    await settle()
    expect(catalog.getState()).toMatchObject({
      status: "loaded",
      models: [opus],
    })
    expect(source.modelLoads).toBe(2)
  })

  it("retry does nothing unless the fetch failed", async () => {
    const source = inMemoryCatalogSource({ models: [opus] })
    const catalog = createModelCatalog(source)
    catalog.load()
    await settle()
    catalog.retry()
    expect(source.modelLoads).toBe(1)
  })

  it("tells subscribers when the state changes", async () => {
    const catalog = createModelCatalog(
      inMemoryCatalogSource({ models: [opus] })
    )
    const seen: string[] = []
    const unsubscribe = catalog.subscribe(() =>
      seen.push(catalog.getState().status)
    )
    catalog.load()
    await settle()
    unsubscribe()
    expect(seen).toEqual(["loading", "loaded"])
  })

  it("serves each Sandbox's Skill index, sharing concurrent fetches", async () => {
    const skill = {
      name: "deploy",
      description: "Ship it.",
      origin: "repo" as const,
    }
    const app = { name: "knobs", description: "Knobs.", origin: "app" as const }
    const catalog = createModelCatalog(
      inMemoryCatalogSource({ skills: { "sbx-1": [skill], "": [app] } })
    )

    const [a, b] = [
      catalog.loadSkills({ sandboxName: "sbx-1" }),
      catalog.loadSkills({ sandboxName: "sbx-1" }),
    ]
    expect(a).toBe(b)
    expect(await a).toEqual([skill])
    expect(await catalog.loadSkills()).toEqual([app])
  })
})

describe("resolveModels", () => {
  const loaded = {
    status: "loaded" as const,
    models: [opus, sonnet],
    serverDefault: sonnet.id,
  }

  it("is empty while the catalog is still loading", () => {
    const state = {
      status: "loading" as const,
      models: [],
      serverDefault: null,
    }
    expect(resolveModels(state, { stored: opus.id })).toEqual({
      model: opus.id,
      defaultModel: opus.id,
      noAgents: false,
    })
    expect(resolveModels(state, {}).model).toBe("")
  })

  it("prefers the chosen model, then the user's default, then the server's", () => {
    expect(
      resolveModels(loaded, { chosen: opus.id, stored: sonnet.id })
    ).toMatchObject({ model: opus.id, defaultModel: sonnet.id })
    expect(resolveModels(loaded, { stored: opus.id })).toMatchObject({
      model: opus.id,
      defaultModel: opus.id,
    })
    expect(resolveModels(loaded, {})).toMatchObject({
      model: sonnet.id,
      defaultModel: sonnet.id,
    })
  })

  it("drops a chosen or stored model the catalog no longer lists", () => {
    expect(
      resolveModels(loaded, { chosen: "gone", stored: "also-gone" })
    ).toMatchObject({ model: sonnet.id, defaultModel: sonnet.id })
  })

  it("falls back to the first model with no server default", () => {
    const state = { ...loaded, serverDefault: null }
    expect(resolveModels(state, {}).model).toBe(opus.id)
  })
})
