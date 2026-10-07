import { execFile } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { promisify } from "node:util"

import { afterAll, describe, expect, it } from "vitest"

import { generateExtensionRegistry } from "./codegen.mjs"

const run = promisify(execFile)
const appDir = path.join(import.meta.dirname, "..", "..")
// Inside the app's node_modules, so an extension's `zod` import resolves the
// way it does from `apps/app/extensions/`.
const work = path.join(appDir, "node_modules", ".cache", "extensions-typecheck")

const GOOD = `
import { z } from "zod"
import { defineImplementation, defineServerExtension } from "@/lib/extensions/types"

export default defineServerExtension({
  implementations: {
    fixture: {
      hello: defineImplementation({
        options: z.object({ name: z.string() }),
        create: ({ name }) => ({ describe: () => "hello " + name }),
      }),
    },
  },
})
`

/** Returns a number, and doesn't use the typed helper: the registry still catches it. */
const BAD = `
import { z } from "zod"

export default {
  implementations: {
    fixture: {
      hello: { options: z.object({}), create: () => ({ describe: () => 42 }) },
    },
  },
}
`

/** Type-check a generated registry over one extension, the way `typecheck` does. */
async function typecheck(name: string, server: string) {
  const root = path.join(work, name)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(path.join(root, "extensions", "acme"), { recursive: true })
  writeFileSync(path.join(root, "extensions", "acme", "server.ts"), server)
  generateExtensionRegistry({
    dir: path.join(root, "extensions"),
    outDir: root,
    log: false,
  })
  // Next's own types declare `server-only` in the app; this program has none.
  writeFileSync(
    path.join(root, "server-only.d.ts"),
    'declare module "server-only"\n'
  )
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      extends: path.join(appDir, "tsconfig.json"),
      compilerOptions: {
        noEmit: true,
        incremental: false,
        plugins: [],
        // The interfaces' types reach Node's (a Coding CLI's process runner).
        types: ["node"],
      },
      include: [],
      files: [
        path.join(root, "server-only.d.ts"),
        path.join(root, "server.generated.ts"),
      ],
    })
  )
  const tsc = path.join(appDir, "node_modules", "typescript", "bin", "tsc")
  return run(process.execPath, [tsc, "-p", root]).then(
    () => ({ ok: true, output: "" }),
    (err: { stdout: string }) => ({ ok: false, output: err.stdout })
  )
}

describe("typecheck over the extensions folder", () => {
  afterAll(() => rmSync(work, { recursive: true, force: true }))

  it("passes an extension that matches its interface", async () => {
    expect(await typecheck("good", GOOD)).toEqual({ ok: true, output: "" })
  }, 60_000)

  it("fails an extension that doesn't", async () => {
    const result = await typecheck("bad", BAD)
    expect(result.ok).toBe(false)
    expect(result.output).toMatch(/server\.generated\.ts.*error TS2322/)
    expect(result.output).toContain(
      "Type 'number' is not assignable to type 'string'"
    )
  }, 60_000)
})
