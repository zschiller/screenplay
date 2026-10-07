import { mkdtempSync, statSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  DEFAULT_HOST_PORT,
  dataFolderOf,
  hostPortOf,
  loadSecrets,
  serverEnv,
} from "./start"

function setup() {
  const dataFolder = mkdtempSync(path.join(tmpdir(), "headless-data-"))
  return { dataFolder }
}

describe("the Headless server's environment", () => {
  it("keeps everything a restart needs in the data folder", () => {
    const { dataFolder } = setup()
    const env = serverEnv({
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
  })

  it("takes its data folder and port from the environment, with defaults", () => {
    expect(dataFolderOf({})).toBe(
      path.join(homedir(), ".screenplay", "headless")
    )
    expect(dataFolderOf({ SCREENPLAY_DATA_FOLDER: "/srv/screenplay" })).toBe(
      "/srv/screenplay"
    )
    expect(hostPortOf({})).toBe(DEFAULT_HOST_PORT)
    expect(hostPortOf({ SCREENPLAY_HOST_PORT: "4200" })).toBe(4200)
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
