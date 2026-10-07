import { mkdtempSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { parseConfig } from "@/lib/extensions/config"

import { loadSecrets, serverEnv } from "./start"

function setup() {
  const dataFolder = mkdtempSync(path.join(tmpdir(), "headless-data-"))
  const config = parseConfig(
    `{ "outboundProxy": { "url": "http://proxy.corp:3128" } }`,
    path.join(dataFolder, "screenplay.config.jsonc")
  )
  return { dataFolder, config }
}

describe("the Headless server's environment", () => {
  it("keeps everything a restart needs in the data folder", () => {
    const { dataFolder, config } = setup()
    const env = serverEnv({
      config,
      dataFolder,
      hostPort: 4100,
      portlessPort: 1355,
      chrome: null,
      secrets: loadSecrets(dataFolder),
      appDir: "/app",
    })
    for (const key of [
      "PGLITE_DATA_DIR",
      "YJS_PERSISTENCE_DIR",
      "LOCAL_BLOB_DIR",
      "LOCAL_FILES_DIR",
      "SCREENPLAY_COORDINATOR_ROOT",
      "SCREENPLAY_WORKTREE_ROOT",
    ]) {
      expect(env[key]!.startsWith(dataFolder + path.sep)).toBe(true)
      expect(statSync(env[key]!).isDirectory()).toBe(true)
    }
    expect(env.NEXT_PUBLIC_SCREENPLAY_PROFILE).toBe("headless")
    expect(env.PORT).toBe("4100")
    expect(env.HOSTNAME).toBe("127.0.0.1")
    expect(env.SCREENPLAY_CONFIG).toBe(config.file)
    expect(env.HTTPS_PROXY).toBe("http://proxy.corp:3128")
  })

  it("mints its keys once and reads the same ones back after a restart", () => {
    const { dataFolder } = setup()
    const first = loadSecrets(dataFolder)
    expect(first.encryptionKey).toMatch(/^[0-9a-f]{64}$/)
    expect(loadSecrets(dataFolder)).toEqual(first)
    expect(statSync(path.join(dataFolder, "secrets.json")).mode & 0o777).toBe(
      0o600
    )
  })
})
