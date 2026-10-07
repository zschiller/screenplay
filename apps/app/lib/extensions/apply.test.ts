import { afterEach, describe, expect, it } from "vitest"

import { hostCatalog, setHostHarnesses } from "@/lib/agent/harnesses"
import { githubAccess, setGitHubAccess } from "@/lib/github-access"
import { createGhCliAccess } from "@/lib/github-access/gh-cli"
import {
  getPreviewExposure,
  loopbackExposure,
  setPreviewExposure,
} from "@/lib/preview-exposure"

import { applyConfiguredInterfaces } from "./apply"
import { ConfigError, parseConfig } from "./config"

afterEach(() => {
  setPreviewExposure(loopbackExposure())
  setGitHubAccess(createGhCliAccess({}))
  setHostHarnesses(null)
})

function problems(text: string): string[] {
  try {
    parseConfig(text, "/box/screenplay.config.jsonc")
  } catch (err) {
    expect(err).toBeInstanceOf(ConfigError)
    return (err as ConfigError).problems
  }
  throw new Error("expected the config to be refused")
}

describe("the Headless interfaces in the config file", () => {
  it("builds what the file names and hands it to the server", async () => {
    const config = parseConfig(
      `{
        "previewExposure": {
          "use": "url-template",
          "origin": "https://{port}-box.corp.example",
          "ports": { "from": 20000, "to": 20199 },
        },
        "githubAccess": { "use": "gh-cli", "command": "corp-gh", "hostname": "ghe.corp.example" },
        "codingCli": [
          { "use": "claude-code" },
          { "use": "opencode", "key": "corp-code", "label": "Corp Code", "command": "corp-code" },
        ],
      }`,
      "/box/screenplay.config.jsonc"
    )
    expect(config.named).toEqual([
      "githubAccess",
      "codingCli",
      "previewExposure",
    ])

    await applyConfiguredInterfaces(config)

    expect(getPreviewExposure().bind).toEqual({
      host: "0.0.0.0",
      ports: { from: 20000, to: 20199 },
    })
    expect(await getPreviewExposure().expose(20001)).toEqual({
      browserOrigin: "https://20001-box.corp.example",
    })
    expect(githubAccess.id).toBe("gh-cli")
    expect(githubAccess.apiUrl).toBe("https://ghe.corp.example/api/v3")
    const clis = hostCatalog()
    expect(clis.map((h) => [h.key, h.hostBinary])).toEqual([
      ["claude-code", "claude"],
      ["corp-code", "corp-code"],
    ])
    // A built-in keeps everything it carries beyond the interface.
    expect(clis[0]!.models?.length).toBeGreaterThan(0)
  })

  it("leaves an interface the file doesn't name at its own default", async () => {
    const before = hostCatalog()
    await applyConfiguredInterfaces(
      parseConfig("{}", "/box/screenplay.config.jsonc")
    )
    expect(getPreviewExposure().bind.host).toBe("127.0.0.1")
    expect(hostCatalog()).toBe(before)
  })

  it("refuses bad options for each, naming the field", () => {
    expect(
      problems(`{
        "previewExposure": { "use": "url-template", "origin": "https://box.corp.example" },
        "githubAccess": { "use": "gh-cli", "hostnme": "ghe.corp.example" },
        "codingCli": { "use": "claude-code" },
      }`)
    ).toEqual([
      "githubAccess.hostnme: not a setting Screenplay knows",
      `codingCli: expected a list of { "use": "<id>", …options }`,
      "previewExposure.origin: must contain {port}",
    ])
  })
})
