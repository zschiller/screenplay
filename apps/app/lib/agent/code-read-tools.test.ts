import { describe, expect, it, vi } from "vitest"

import {
  buildCodeReadTools,
  codeCheckouts,
  type CodeReader,
} from "@/lib/agent/code-read-tools"
import type { RoomCollections } from "@/lib/yjs/schema"
import { baseBranch, baseRepo, makeHarness } from "@/test/canvas/harness"

/**
 * A chat's reads of other Workspaces' code: each reads one Workspace's
 * checkout, picked by `workspaceId` or, when there is only one, by default.
 */

function room(setup: (c: RoomCollections) => void) {
  const { collections } = makeHarness()
  setup(collections)
  return collections
}

/** A Sandbox serving `files`, recording the commands it's asked to run. */
function fakeSandbox(files: Record<string, string>, stdout = "") {
  const commands: string[][] = []
  const sandbox: CodeReader = {
    readFileToBuffer: async ({ path }) =>
      path in files ? Buffer.from(files[path]!) : null,
    runCommand: (async (cmd: string, args: string[] = []) => {
      commands.push([cmd, ...args])
      return { exitCode: 0, stdout: async () => stdout, stderr: async () => "" }
    }) as CodeReader["runCommand"],
  }
  return { sandbox, commands }
}

function tools(
  collections: RoomCollections,
  sandboxes: Record<string, CodeReader>,
  ownSandboxName?: string
) {
  const openSandbox = vi.fn(async (name: string) => {
    const sandbox = sandboxes[name]
    if (!sandbox) throw new Error("its sandbox isn't running")
    return sandbox
  })
  return {
    openSandbox,
    tools: buildCodeReadTools({
      readDoc: async (fn) => fn(collections),
      openSandbox,
      ownSandboxName,
    }),
  }
}

const run = (
  t: { execute?: (input: never, opts: never) => unknown },
  input: unknown
) => t.execute!(input as never, {} as never) as Promise<string>

describe("codeCheckouts", () => {
  it("lists Workspaces that have a checkout, oldest first, with their repository", () => {
    const c = room((c) => {
      c.repos.set("repo-1", baseRepo("repo-1", { name: "web" }))
      c.branches.set(
        "ws-2",
        baseBranch("ws-2", { title: "Checkout copy", createdAt: 2 })
      )
      c.branches.set(
        "ws-1",
        baseBranch("ws-1", { title: "Sign-in fix", createdAt: 1 })
      )
      c.branches.set(
        "ws-3",
        baseBranch("ws-3", { sandboxName: "", createdAt: 3 })
      )
    })

    expect(codeCheckouts(c)).toEqual([
      {
        workspaceId: "ws-1",
        title: "Sign-in fix",
        repo: "web",
        sandboxName: "sandbox-ws-1",
      },
      {
        workspaceId: "ws-2",
        title: "Checkout copy",
        repo: "web",
        sandboxName: "sandbox-ws-2",
      },
    ])
  })
})

describe("buildCodeReadTools", () => {
  it("reads from the only Workspace when no workspaceId is passed", async () => {
    const c = room((c) => {
      c.repos.set("repo-1", baseRepo("repo-1"))
      c.branches.set("ws-1", baseBranch("ws-1"))
    })
    const { sandbox } = fakeSandbox({ "src/app.tsx": "export {}\n" })
    const { tools: t } = tools(c, { "sandbox-ws-1": sandbox })

    const out = await run(t.read_code_file, { path: "src/app.tsx" })

    expect(out).toContain("export {}")
  })

  it("asks for a workspaceId when the canvas has several", async () => {
    const c = room((c) => {
      c.repos.set("repo-1", baseRepo("repo-1"))
      c.branches.set("ws-1", baseBranch("ws-1", { title: "One" }))
      c.branches.set("ws-2", baseBranch("ws-2", { title: "Two" }))
    })
    const { tools: t, openSandbox } = tools(c, {})

    const out = await run(t.read_code_file, { path: "a.ts" })

    expect(out).toContain("Pass a workspaceId")
    expect(out).toContain('[ws-1] "One"')
    expect(out).toContain('[ws-2] "Two"')
    expect(openSandbox).not.toHaveBeenCalled()
  })

  it("reads the Workspace it's asked for", async () => {
    const c = room((c) => {
      c.repos.set("repo-1", baseRepo("repo-1"))
      c.branches.set("ws-1", baseBranch("ws-1"))
      c.branches.set("ws-2", baseBranch("ws-2"))
    })
    const one = fakeSandbox({}, "")
    const two = fakeSandbox({}, "src/button.tsx:3: export function Button\n")
    const { tools: t } = tools(c, {
      "sandbox-ws-1": one.sandbox,
      "sandbox-ws-2": two.sandbox,
    })

    const out = await run(t.search_code, {
      workspaceId: "ws-2",
      pattern: "Button",
      include: "*.tsx",
    })

    expect(out).toContain("src/button.tsx:3")
    expect(one.commands).toEqual([])
    expect(two.commands[0]?.[0]).toBe("rg")
  })

  it("says there's no code when no Workspace has a checkout", async () => {
    const { tools: t } = tools(
      room(() => {}),
      {}
    )

    expect(await run(t.find_code_files, { pattern: "**/*.ts" })).toContain(
      "no other Workspace with a checkout"
    )
  })

  it("leaves out the reading chat's own Workspace (#1315)", async () => {
    const c = room((c) => {
      c.repos.set("repo-1", baseRepo("repo-1"))
      c.branches.set(
        "ws-1",
        baseBranch("ws-1", { title: "Mine", createdAt: 1 })
      )
      c.branches.set(
        "ws-2",
        baseBranch("ws-2", { title: "Theirs", createdAt: 2 })
      )
    })
    const own = fakeSandbox({ "a.ts": "mine" })
    const other = fakeSandbox({ "a.ts": "theirs" })
    const { tools: t } = tools(
      c,
      { "sandbox-ws-1": own.sandbox, "sandbox-ws-2": other.sandbox },
      "sandbox-ws-1"
    )

    // With only one other Workspace, the id is optional and it's that one.
    expect(await run(t.read_code_file, { path: "a.ts" })).toContain("theirs")
    expect(
      await run(t.read_code_file, { workspaceId: "ws-1", path: "a.ts" })
    ).toContain("No Workspace with a checkout has id ws-1")
  })

  it("answers with the reason when the Sandbox can't be opened", async () => {
    const c = room((c) => {
      c.repos.set("repo-1", baseRepo("repo-1"))
      c.branches.set("ws-1", baseBranch("ws-1", { title: "Sign-in fix" }))
    })
    const { tools: t } = tools(c, {})

    expect(await run(t.read_code_file, { path: "a.ts" })).toBe(
      `Couldn't read Workspace "Sign-in fix": its sandbox isn't running`
    )
  })
})
