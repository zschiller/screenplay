import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Every environment variable the app reads must be documented somewhere under
 * `apps/docs/content` (the reference table is
 * `self-hosting/environment-variables.mdx`), or be listed below as internal.
 * This is what keeps the docs from silently falling behind when a change adds
 * a new knob.
 */

/** Read by the app but not something anyone configures, so not documented. */
const INTERNAL: Record<string, string> = {
  NODE_ENV: "set by Node/Next",
  NEXT_PHASE: "set by Next during build",
  NEXT_RUNTIME: "set by Next per runtime",
  VERCEL: "injected by Vercel",
  VERCEL_BRANCH_URL: "injected by Vercel",
  SHELL: "the user's login shell",
  NEXT_PUBLIC_SCREENPLAY_FIXTURE_WORLD: "screenshot harness fixture switch",
  PORTLESS_STATE_DIR: "mirrors the portless CLI's own override",
  SCREENPLAY_LISTEN_PORT: "set inside a sandbox by provisioning",
  SCREENPLAY_UPSTREAM_PORT: "set inside a sandbox by provisioning",
  SCREENPLAY_LISTEN_HOST: "set inside a sandbox by provisioning",
  SCREENPLAY_SHELL_PID: "set by the desktop shell for its own watchdog",
}

const appRoot = fileURLToPath(new URL("../", import.meta.url))
const docsRoot = path.join(appRoot, "../docs/content")

const SOURCE_DIRS = ["app", "lib", "components", "hooks"]
const SOURCE_EXT = /\.(ts|tsx|mjs)$/
const SKIP = /\.test\.|fake-acp/
// `process.env.FOO`, `process.env["FOO"]`, and `*_ENV_VAR = "FOO"` constants
// used as `process.env[FOO_ENV_VAR]`.
const ENV_READ =
  /process\.env(?:\.([A-Z][A-Z0-9_]*)|\["([A-Z][A-Z0-9_]*)"\])|_ENV_VAR\s*=\s*"([A-Z][A-Z0-9_]*)"/g

function walk(dir: string, match: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === "node_modules" ? [] : walk(full, match)
    }
    return match.test(entry.name) ? [full] : []
  })
}

function envVarsReadByApp(): Set<string> {
  const files = [
    ...SOURCE_DIRS.flatMap((dir) => walk(path.join(appRoot, dir), SOURCE_EXT)),
    ...readdirSync(appRoot)
      .filter((name) => SOURCE_EXT.test(name))
      .map((name) => path.join(appRoot, name)),
  ].filter((file) => !SKIP.test(file))
  const names = new Set<string>()
  for (const file of files) {
    for (const m of readFileSync(file, "utf8").matchAll(ENV_READ)) {
      names.add((m[1] ?? m[2] ?? m[3])!)
    }
  }
  return names
}

describe("environment variable docs", () => {
  const read = envVarsReadByApp()
  const docs = walk(docsRoot, /\.mdx?$/)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n")

  it("finds the env vars the app reads", () => {
    expect(read.size).toBeGreaterThan(20)
  })

  it("documents every env var the app reads", () => {
    const undocumented = [...read]
      .filter((name) => !(name in INTERNAL))
      .filter((name) => !new RegExp(`\\b${name}\\b`).test(docs))
      .sort()
    // Add each to apps/docs/content/self-hosting/environment-variables.mdx,
    // or to INTERNAL above if it isn't something anyone sets.
    expect(undocumented).toEqual([])
  })

  it("lists no internal env var the app no longer reads", () => {
    expect(Object.keys(INTERNAL).filter((name) => !read.has(name))).toEqual([])
  })
})
