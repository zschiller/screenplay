import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Room Access (#900, #904, #906) is the one way server code reaches a Room's
 * doc, so an unauthorized room write can't be expressed from an action file or
 * route. This keeps it that way: the raw room-doc helpers stay private to
 * `lib/room-access.ts`, and its session-less reader stays with the one
 * server-triggered job that needs it.
 */

const appRoot = fileURLToPath(new URL("../", import.meta.url))
const SOURCE_DIRS = ["app", "lib", "components", "hooks"]
const SOURCE_EXT = /\.(ts|tsx)$/
const SKIP = /\.test\./

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : walk(full)
    }
    return SOURCE_EXT.test(entry.name) && !SKIP.test(entry.name) ? [full] : []
  })
}

const sources = SOURCE_DIRS.flatMap((dir) => walk(path.join(appRoot, dir))).map(
  (file) => ({
    file: path.relative(appRoot, file).split(path.sep).join("/"),
    text: readFileSync(file, "utf8"),
  })
)

/** Files whose source matches `pattern`. */
function filesMatching(pattern: RegExp): string[] {
  return sources.filter((s) => pattern.test(s.text)).map((s) => s.file)
}

describe("Room Access guard", () => {
  it("scans the app's source", () => {
    expect(sources.length).toBeGreaterThan(100)
  })

  it("only Room Access imports the raw room-doc helpers", () => {
    // `mutateRoomDoc`/`readRoomDoc` named in an import from the yjs server
    // module, whichever way the path is spelled.
    const rawImport =
      /import\s*\{[^}]*\b(?:mutateRoomDoc|readRoomDoc)\b[^}]*\}\s*from\s*["'][^"']*yjs\/server["']/
    expect(filesMatching(rawImport)).toEqual(["lib/room-access.ts"])
  })

  it("only the yjs server module talks to the host's doc read and write", () => {
    expect(filesMatching(/yjsHost\.(?:mutateDoc|readDoc)\b/)).toEqual([
      "lib/yjs/server.ts",
    ])
  })

  it("only the chat broadcast writer imports the yjs server module otherwise", () => {
    // Chat stream events ride the doc too; their writer is the one other
    // importer, and every route that broadcasts opens the Room first.
    const importsServer = /from\s*["']@\/lib\/yjs\/server["']/
    expect(filesMatching(importsServer).sort()).toEqual([
      "lib/agent/broadcast.ts",
      "lib/room-access.ts",
    ])
  })

  it("every route that broadcasts to a chat opens its Room first", () => {
    const broadcasting = sources.filter(
      (s) =>
        s.file.startsWith("app/") &&
        /from\s*["']@\/lib\/agent\/broadcast["']/.test(s.text)
    )
    expect(broadcasting.length).toBeGreaterThan(0)
    for (const route of broadcasting) {
      expect(route.text, route.file).toMatch(/\bopenRoomForRoute\(/)
    }
  })

  it("the session-less reader is used only by the server-triggered layout rebuild", () => {
    const users = filesMatching(/\breadRoomForServer\b/).filter(
      (file) => file !== "lib/room-access.ts"
    )
    expect(users).toEqual(["lib/thumbnail/rebuild-layout.ts"])
  })

  it("the session-less writer is used only by the PR Watch tick", () => {
    const users = filesMatching(/\bopenRoomForPrWatchTick\b/).filter(
      (file) => file !== "lib/room-access.ts"
    )
    expect(users).toEqual(["lib/pr-watch/run.ts"])
  })
})
