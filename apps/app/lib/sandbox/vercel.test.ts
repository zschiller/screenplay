import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const sdk = vi.hoisted(() => ({ create: vi.fn(), get: vi.fn() }))
vi.mock("@vercel/sandbox", () => ({ Sandbox: sdk }))

import {
  DEFAULT_SANDBOX_IMAGE,
  getVercelSandboxProvider,
  LIFT_CHECKOUT_SCRIPT,
} from "@/lib/sandbox/vercel"
import type { SandboxCreateOptions } from "@/lib/sandbox/types"

type FakeSdkSandbox = {
  name: string
  image?: string
  status: string
  runCommand: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

function fakeSdkSandbox(
  overrides: Partial<FakeSdkSandbox> = {},
  lift = { exitCode: 0, stderr: "" }
): FakeSdkSandbox {
  return {
    name: "sp-test",
    image: "screenplay-workspace@sha256:abc",
    status: "running",
    runCommand: vi.fn(async () => ({
      exitCode: lift.exitCode,
      stderr: async () => lift.stderr,
    })),
    stop: vi.fn(async () => {}),
    ...overrides,
  }
}

const gitOpts: SandboxCreateOptions = {
  name: "sp-test",
  source: { type: "git", url: "https://github.com/o/r.git", revision: "main" },
  ports: [3000, 4000, 7681],
  timeout: 1000,
  resources: { vcpus: 4 },
}

const snapshotOpts: SandboxCreateOptions = {
  ...gitOpts,
  source: { type: "snapshot", snapshotId: "snap_1" },
}

describe("VercelSandboxProvider.create", () => {
  beforeEach(() => {
    sdk.create.mockReset()
    sdk.get.mockReset()
    vi.unstubAllEnvs()
  })

  it("boots a fresh Sandbox from our image at the requested size", async () => {
    sdk.create.mockResolvedValue(fakeSdkSandbox())
    await getVercelSandboxProvider().create(gitOpts)
    const params = sdk.create.mock.calls[0][0]
    expect(params.image).toBe(DEFAULT_SANDBOX_IMAGE)
    expect(params.runtime).toBeUndefined()
    expect(params.resources).toEqual({ vcpus: 4 })
    expect(params.ports).toEqual([3000, 4000, 7681])
  })

  it("uses SANDBOX_IMAGE when it's set", async () => {
    vi.stubEnv("SANDBOX_IMAGE", "team/project/custom:v2")
    sdk.create.mockResolvedValue(fakeSdkSandbox())
    await getVercelSandboxProvider().create(gitOpts)
    expect(sdk.create.mock.calls[0][0].image).toBe("team/project/custom:v2")
  })

  it("moves the clone to the worktree and reports the image layout", async () => {
    const sb = fakeSdkSandbox()
    sdk.create.mockResolvedValue(sb)
    const instance = await getVercelSandboxProvider().create(gitOpts)
    expect(sb.runCommand).toHaveBeenCalledWith({
      cmd: "bash",
      args: ["-c", LIFT_CHECKOUT_SCRIPT],
      cwd: "/vercel",
    })
    expect(instance.worktreePath).toBe("/vercel/sandbox")
    expect(instance.homeDir).toBe("/vercel")
  })

  it("restores a snapshot without an image or a move", async () => {
    const sb = fakeSdkSandbox()
    sdk.create.mockResolvedValue(sb)
    await getVercelSandboxProvider().create(snapshotOpts)
    expect(sdk.create.mock.calls[0][0].image).toBeUndefined()
    expect(sb.runCommand).not.toHaveBeenCalled()
  })

  it("keeps the legacy runtime's home for a Sandbox from before the image", async () => {
    sdk.create.mockResolvedValue(fakeSdkSandbox({ image: undefined }))
    const instance = await getVercelSandboxProvider().create(snapshotOpts)
    expect(instance.worktreePath).toBe("/vercel/sandbox")
    expect(instance.homeDir).toBe("/home/vercel-sandbox")
  })

  it("stops the Sandbox and fails when the clone can't be moved", async () => {
    const sb = fakeSdkSandbox({}, { exitCode: 1, stderr: "no git checkout" })
    sdk.create.mockResolvedValue(sb)
    await expect(getVercelSandboxProvider().create(gitOpts)).rejects.toThrow(
      /no git checkout/
    )
    expect(sb.stop).toHaveBeenCalled()
  })

  it("names the image when the registry doesn't have it", async () => {
    sdk.create.mockRejectedValue(new Error("Status code 404: not_found"))
    await expect(getVercelSandboxProvider().create(gitOpts)).rejects.toThrow(
      /Sandbox image "screenplay-workspace" isn't available/
    )
  })
})

describe("VercelSandboxProvider.get", () => {
  it("reads the layout from the Sandbox it resumes", async () => {
    sdk.get.mockResolvedValue(fakeSdkSandbox({ image: undefined }))
    const legacy = await getVercelSandboxProvider().get({ name: "sp-old" })
    expect(legacy.homeDir).toBe("/home/vercel-sandbox")
    sdk.get.mockResolvedValue(fakeSdkSandbox())
    const current = await getVercelSandboxProvider().get({ name: "sp-new" })
    expect(current.homeDir).toBe("/vercel")
  })
})

// The move runs for real against a scratch directory standing in for /vercel.
describe("LIFT_CHECKOUT_SCRIPT", () => {
  let root: string
  const worktree = () => path.join(root, "sandbox")
  const lift = () =>
    execFileSync(
      "bash",
      ["-c", LIFT_CHECKOUT_SCRIPT.replaceAll("/vercel", root)],
      { cwd: root, encoding: "utf8", stdio: "pipe" }
    )
  const fakeClone = (dir: string) => {
    mkdirSync(path.join(dir, ".git"), { recursive: true })
    writeFileSync(path.join(dir, "package.json"), "{}")
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "lift-"))
    mkdirSync(path.join(root, ".config"))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it("moves a clone made inside the worktree directory up into it", () => {
    fakeClone(path.join(worktree(), "my-app"))
    lift()
    expect(existsSync(path.join(worktree(), ".git"))).toBe(true)
    expect(existsSync(path.join(worktree(), "my-app"))).toBe(false)
  })

  it("moves a clone made next to it in the home directory", () => {
    fakeClone(path.join(root, "my-app"))
    lift()
    expect(existsSync(path.join(worktree(), "package.json"))).toBe(true)
    expect(existsSync(path.join(root, "my-app"))).toBe(false)
  })

  it("keeps a repo folder that shares the repo's name", () => {
    const clone = path.join(worktree(), "app")
    fakeClone(clone)
    mkdirSync(path.join(clone, "app"))
    writeFileSync(path.join(clone, "app", "page.tsx"), "x")
    lift()
    expect(readFileSync(path.join(worktree(), "app", "page.tsx"), "utf8")).toBe(
      "x"
    )
  })

  it("leaves a checkout that's already in place alone", () => {
    fakeClone(worktree())
    lift()
    expect(existsSync(path.join(worktree(), ".git"))).toBe(true)
  })

  it("fails when there's no checkout", () => {
    expect(lift).toThrow()
  })
})
