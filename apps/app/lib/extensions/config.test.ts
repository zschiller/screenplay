import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  CONFIG_ENV_VAR,
  ConfigError,
  createConfigured,
  loadConfig,
  parseConfig,
} from "./config"
import type { Fixture } from "./fixture"
import {
  defineImplementation,
  defineServerExtension,
  type ServerExtension,
} from "./types"

/** A fixture extension, as `extensions/acme/server.ts` would export it. */
const extensions: Record<string, ServerExtension> = {
  acme: defineServerExtension({
    implementations: {
      fixture: {
        hello: defineImplementation({
          options: z.object({ name: z.string(), loud: z.boolean().optional() }),
          create: ({ name, loud }): Fixture => ({
            describe: () => (loud ? `HELLO ${name}` : `hello ${name}`),
          }),
        }),
      },
    },
  }),
}

function problems(text: string): string[] {
  try {
    parseConfig(text, "/box/screenplay.config.jsonc", extensions)
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError)
    return (err as ConfigError).problems
  }
  throw new Error("expected the config to be refused")
}

describe("parseConfig", () => {
  it("uses every default when there is no file", () => {
    const config = parseConfig(null, null, extensions)
    expect(config.file).toBeNull()
    expect(config.interfaces.fixture.map((s) => s.use)).toEqual(["plain"])
  })

  it("picks an extension's implementation by <extension>/<name> with its options", async () => {
    const config = parseConfig(
      `{
        // the fixture
        "fixture": { "use": "acme/hello", "name": "box", "loud": true },
      }`,
      "/box/screenplay.config.jsonc",
      extensions
    )
    expect(config.interfaces.fixture[0].use).toBe("acme/hello")
    expect(config.interfaces.fixture[0].options).toEqual({
      name: "box",
      loud: true,
    })
    const dataFolder = mkdtempSync(path.join(tmpdir(), "screenplay-data-"))
    const [fixture] = await createConfigured("fixture", {
      ...config,
      dataFolder,
    })
    expect(fixture.describe()).toBe("HELLO box")
  })

  it("resolves the data folder and CA file against the config file's folder", () => {
    const config = parseConfig(
      `{ "dataFolder": "data", "outboundProxy": { "url": "http://proxy:3128", "caFile": "ca.pem" } }`,
      "/box/screenplay.config.jsonc",
      extensions
    )
    expect(config.dataFolder).toBe("/box/data")
    expect(config.outboundProxy?.caFile).toBe("/box/ca.pem")
  })

  it("defaults the data folder to the config file's folder", () => {
    expect(
      parseConfig(`{}`, "/box/screenplay.config.jsonc", extensions).dataFolder
    ).toBe("/box")
  })

  it("accepts listeners", () => {
    const config = parseConfig(
      `{ "listeners": { "host": { "port": 4000 }, "viewers": [{ "name": "corp", "address": "0.0.0.0", "port": 4100 }] } }`,
      "/box/screenplay.config.jsonc",
      extensions
    )
    expect(config.listeners?.viewers?.[0].port).toBe(4100)
  })

  it("refuses a bad config with a message naming each field", () => {
    expect(
      problems(`{
        "listeners": { "host": { "port": "4000", "address": "0.0.0.0" } },
        "outboundProxy": { "url": "not a url" },
        "colour": "pink",
      }`)
    ).toEqual([
      expect.stringMatching(/^listeners\.host\.port: /),
      "listeners.host.address: not a setting Screenplay knows",
      expect.stringMatching(/^outboundProxy\.url: /),
      "colour: not a setting Screenplay knows",
    ])
  })

  it("names an unknown implementation and lists the known ones", () => {
    expect(problems(`{ "fixture": { "use": "acme/bye" } }`)).toEqual([
      `fixture.use: "acme/bye" isn’t a built-in or an extension this build picked up; known: plain, acme/hello`,
    ])
    expect(problems(`{ "fixture": { "name": "box" } }`)).toEqual([
      "fixture.use: required; one of plain, acme/hello",
    ])
  })

  it("checks an implementation's options against its own schema", () => {
    expect(
      problems(`{ "fixture": { "use": "acme/hello", "nmae": "box" } }`)
    ).toEqual([
      expect.stringMatching(/^fixture\.name: /),
      "fixture.nmae: not a setting Screenplay knows",
    ])
  })

  it("refuses text that isn't JSON with comments", () => {
    expect(problems(`{ "fixture": }`)).toEqual([
      expect.stringMatching(/^not JSON with comments: /),
    ])
  })

  it("puts the file and every problem in the error message", () => {
    expect(() =>
      parseConfig(`{ "colour": 1 }`, "/box/screenplay.config.jsonc")
    ).toThrow(
      "/box/screenplay.config.jsonc isn’t valid, so Screenplay won’t start:\n  colour: not a setting Screenplay knows"
    )
  })
})

describe("loadConfig", () => {
  it("uses the defaults when SCREENPLAY_CONFIG is unset", () => {
    expect(loadConfig({}).file).toBeNull()
  })

  it("reads the file SCREENPLAY_CONFIG names", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "screenplay-config-"))
    const file = path.join(dir, "screenplay.config.jsonc")
    writeFileSync(file, `{ "fixture": { "use": "plain", "text": "hi" } }`)
    const config = loadConfig({ [CONFIG_ENV_VAR]: file })
    expect(config.file).toBe(file)
    expect(config.interfaces.fixture[0].options).toEqual({ text: "hi" })
  })

  it("refuses a file it can't read", () => {
    expect(() =>
      loadConfig({ [CONFIG_ENV_VAR]: "/no/such/screenplay.config.jsonc" })
    ).toThrow(/can’t be read/)
  })
})
