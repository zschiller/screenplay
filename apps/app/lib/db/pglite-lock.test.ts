import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { lockDataDir } from "./pglite"

// The data-dir lock is the guarantee that two PGlite processes never open the
// same dir at once (concurrent writers corrupt it irrecoverably). These exercise
// the real lockfile, using the parent pid as a live "foreign owner" so no
// process spawning is needed (which the test sandbox blocks).

let root: string
let dir: string
const lockPath = () => `${dir}.lock`

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pglite-lock-"))
  dir = join(root, "pglite")
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("lockDataDir", () => {
  it("acquires a free dir and records our pid", () => {
    const release = lockDataDir(dir)
    expect(existsSync(lockPath())).toBe(true)
    expect(readFileSync(lockPath(), "utf8").trim()).toBe(String(process.pid))
    release()
    expect(existsSync(lockPath())).toBe(false)
  })

  it("refuses a dir held by another LIVE process — never opens concurrently", () => {
    // process.ppid is alive and not us: a faithful "foreign live owner".
    writeFileSync(lockPath(), String(process.ppid))
    expect(() => lockDataDir(dir)).toThrow(/already open in another live process/)
    // The foreign lock is left intact (not clobbered).
    expect(readFileSync(lockPath(), "utf8").trim()).toBe(String(process.ppid))
  })

  it("refuses a dir already held by THIS process — a same-pid second opener", () => {
    // A second open inside one process (e.g. the db module evaluated in two
    // Turbopack module registries) is as corrupting as a foreign one and must
    // not be silently reclaimed. The live owner here is our own pid.
    writeFileSync(lockPath(), String(process.pid))
    expect(() => lockDataDir(dir)).toThrow(/already open in THIS process/)
    expect(readFileSync(lockPath(), "utf8").trim()).toBe(String(process.pid))
  })

  it("reclaims a stale lock left by a dead process", () => {
    writeFileSync(lockPath(), "999999") // a pid that doesn't exist
    const release = lockDataDir(dir)
    expect(readFileSync(lockPath(), "utf8").trim()).toBe(String(process.pid))
    release()
  })

  it("is re-acquirable after release", () => {
    lockDataDir(dir)()
    const release = lockDataDir(dir)
    expect(existsSync(lockPath())).toBe(true)
    release()
  })

  it("does not lock the in-memory database", () => {
    const release = lockDataDir("memory://")
    expect(existsSync("memory://.lock")).toBe(false)
    release()
  })
})
