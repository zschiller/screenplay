import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  generateExtensionRegistry,
  listExtensions,
  registrySource,
} from "./codegen.mjs"

function folder(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "extensions-"))
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    writeFileSync(path.join(dir, name), content)
  }
  return dir
}

/** The registry's code, without its header comment. */
function code(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.startsWith("//"))
    .join("\n")
    .trim()
}

describe("listExtensions", () => {
  it("finds nothing in an absent or empty folder", () => {
    expect(listExtensions(path.join(tmpdir(), "no-such-extensions"))).toEqual(
      []
    )
    expect(listExtensions(folder({ "README.md": "hi" }))).toEqual([])
  })

  it("names each extension by its folder, sorted, with its server and client files", () => {
    const dir = folder({
      "zeta/server.ts": "",
      "acme/server.ts": "",
      "acme/client.tsx": "",
      "acme/node_modules/x/server.ts": "",
      "node_modules/y/server.ts": "",
      ".cache/server.ts": "",
    })
    expect(listExtensions(dir)).toEqual([
      {
        id: "acme",
        path: path.join(dir, "acme"),
        files: { server: "server.ts", client: "client.tsx" },
      },
      {
        id: "zeta",
        path: path.join(dir, "zeta"),
        files: { server: "server.ts", client: undefined },
      },
    ])
  })

  it("refuses a folder whose name can't be an id", () => {
    expect(() => listExtensions(folder({ "Acme Corp/server.ts": "" }))).toThrow(
      /lowercase letters, digits and dashes/
    )
  })

  it("refuses a folder that adds nothing", () => {
    expect(() => listExtensions(folder({ "acme/index.ts": "" }))).toThrow(
      /has no server\.ts or client\.tsx/
    )
  })
})

describe("generateExtensionRegistry", () => {
  it("writes typed registries that import each extension by relative path", () => {
    const dir = folder({ "acme/server.ts": "", "acme/client.tsx": "" })
    const out = folder()
    expect(generateExtensionRegistry({ dir, outDir: out, log: false })).toEqual(
      { extensions: ["acme"] }
    )
    const server = readFileSync(path.join(out, "server.generated.ts"), "utf8")
    expect(server).toContain('import "server-only"')
    expect(server).toContain(
      `import ext0 from "${path.relative(out, path.join(dir, "acme/server"))}"`
    )
    expect(server).toContain(
      "export const serverExtensions: Record<string, ServerExtension> = {"
    )
    const client = readFileSync(path.join(out, "client.generated.ts"), "utf8")
    expect(client).not.toContain("server-only")
    expect(client).toContain('"acme": ext0,')
  })

  it("writes empty registries when there are no extensions", () => {
    const out = folder()
    generateExtensionRegistry({ dir: folder(), outDir: out, log: false })
    expect(readFileSync(path.join(out, "server.generated.ts"), "utf8")).toMatch(
      /= \{\n\}/
    )
  })
})

describe("the checked-in empty registries", () => {
  it.each(["server", "client"] as const)(
    "match what codegen writes for no extensions (%s)",
    (registry) => {
      const empty = readFileSync(
        path.join(import.meta.dirname, `${registry}.empty.ts`),
        "utf8"
      )
      expect(code(empty)).toBe(
        code(registrySource(registry, [], import.meta.dirname)).replace(
          "= {\n}",
          "= {}"
        )
      )
    }
  )
})
