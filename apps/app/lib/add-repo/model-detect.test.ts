import { describe, expect, it, vi } from "vitest"

import { InMemoryDetectFileSystem } from "@/lib/add-repo/detect-fs"
import {
  buildDetectionPrompt,
  detectSettingsWithModel,
  gatherProjectFiles,
  parseDetectionReply,
} from "@/lib/add-repo/model-detect"
import type { DetectedSettings } from "@/lib/add-repo/resolver"

const baseline: DetectedSettings = {
  setupScript: "pnpm install",
  devScript: "next dev",
  devServerPort: 3000,
}

describe("gatherProjectFiles", () => {
  it("reads manifests, configs and the README, and only names lockfiles", async () => {
    const fs = new InMemoryDetectFileSystem({
      "package.json": "{}",
      "README.md": "# Storefront",
      "next.config.mjs": "export default {}",
      "pnpm-lock.yaml": "lockfileVersion: '9.0'",
      "src/index.ts": "export {}",
      LICENSE: "MIT",
    })
    const project = await gatherProjectFiles(fs)
    expect(project.listing).toEqual([
      "LICENSE",
      "README.md",
      "next.config.mjs",
      "package.json",
      "pnpm-lock.yaml",
      "src/",
    ])
    expect(Object.keys(project.files)).toEqual([
      "package.json",
      "README.md",
      "next.config.mjs",
    ])
  })

  it("reads each workspace package's manifest in a monorepo", async () => {
    const fs = new InMemoryDetectFileSystem({
      "package.json": "{}",
      "apps/web/package.json": '{"name":"web"}',
      "apps/docs/package.json": '{"name":"docs"}',
      "packages/ui/package.json": '{"name":"ui"}',
      "packages/ui/src/index.ts": "",
    })
    const { files } = await gatherProjectFiles(fs)
    expect(Object.keys(files)).toEqual([
      "package.json",
      "apps/docs/package.json",
      "apps/web/package.json",
      "packages/ui/package.json",
    ])
  })

  it("reads the chosen app's manifest first among the packages", async () => {
    const fs = new InMemoryDetectFileSystem({
      "package.json": "{}",
      "apps/web/package.json": '{"name":"web"}',
      "apps/docs/package.json": '{"name":"docs"}',
    })
    const { files } = await gatherProjectFiles(fs, "apps/web")
    expect(Object.keys(files)).toEqual([
      "package.json",
      "apps/web/package.json",
      "apps/docs/package.json",
    ])
  })

  it("clips a long file", async () => {
    const fs = new InMemoryDetectFileSystem({ "README.md": "x".repeat(20_000) })
    const { files } = await gatherProjectFiles(fs)
    expect(files["README.md"]!.length).toBe(6000)
  })
})

describe("buildDetectionPrompt", () => {
  it("carries the listing, the files and the first guess", () => {
    const prompt = buildDetectionPrompt(
      {
        listing: ["package.json", "pnpm-lock.yaml"],
        files: { "package.json": '{"scripts":{"dev":"next dev -p 4000"}}' },
      },
      baseline
    )
    expect(prompt).toContain("Lockfiles present: pnpm-lock.yaml")
    expect(prompt).toContain('<file path="package.json">')
    expect(prompt).toContain("next dev -p 4000")
    expect(prompt).toContain(JSON.stringify(baseline))
    expect(prompt).not.toContain("<chosen_app>")
  })

  it("names the app chosen in a monorepo", () => {
    const prompt = buildDetectionPrompt(
      { listing: ["apps/"], files: {} },
      baseline,
      "apps/docs"
    )
    expect(prompt).toContain("<chosen_app>\napps/docs\n</chosen_app>")
  })
})

describe("parseDetectionReply", () => {
  it("reads a bare JSON answer", () => {
    expect(
      parseDetectionReply(
        '{"setupScript":"pnpm install","devScript":"pnpm dev","devServerPort":4000}',
        baseline
      )
    ).toEqual({
      setupScript: "pnpm install",
      devScript: "pnpm dev",
      devServerPort: 4000,
    })
  })

  it("finds the object inside a fence or prose", () => {
    const reply =
      'Here you go:\n```json\n{"setupScript":"npm ci","devScript":"npm run dev","devServerPort":"5173"}\n```'
    expect(parseDetectionReply(reply, baseline)).toEqual({
      setupScript: "npm ci",
      devScript: "npm run dev",
      devServerPort: 5173,
    })
  })

  it("keeps the first guess for each field that fails validation", () => {
    expect(
      parseDetectionReply(
        '{"setupScript":"a\\nb","devScript":"","devServerPort":70000}',
        baseline
      )
    ).toEqual(baseline)
  })

  it("allows an empty setup script", () => {
    expect(
      parseDetectionReply('{"setupScript":""}', baseline)?.setupScript
    ).toBe("")
  })

  it("is null for no reply or no object", () => {
    expect(parseDetectionReply(null, baseline)).toBeNull()
    expect(parseDetectionReply("I can't tell.", baseline)).toBeNull()
    expect(parseDetectionReply("{not json}", baseline)).toBeNull()
  })
})

describe("detectSettingsWithModel", () => {
  it("asks the model and returns its validated answer", async () => {
    const fs = new InMemoryDetectFileSystem({
      "package.json": '{"scripts":{"dev":"next dev -p 4000"}}',
    })
    const runModel = vi.fn(
      async () =>
        '{"setupScript":"pnpm install","devScript":"pnpm dev","devServerPort":4000}'
    )
    const settings = await detectSettingsWithModel(fs, baseline, runModel)
    expect(settings).toEqual({
      setupScript: "pnpm install",
      devScript: "pnpm dev",
      devServerPort: 4000,
    })
    expect(runModel).toHaveBeenCalledOnce()
  })

  it("is null when no model answers", async () => {
    const fs = new InMemoryDetectFileSystem({ "package.json": "{}" })
    expect(
      await detectSettingsWithModel(fs, baseline, async () => null)
    ).toBeNull()
  })

  it("doesn't call the model for an empty project", async () => {
    const runModel = vi.fn(async () => "{}")
    const fs = new InMemoryDetectFileSystem({})
    expect(await detectSettingsWithModel(fs, baseline, runModel)).toBeNull()
    expect(runModel).not.toHaveBeenCalled()
  })
})
