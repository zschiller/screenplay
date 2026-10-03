import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Every environment variable the app reads must have its own row in the
 * reference tables in `apps/docs/content/self-hosting/environment-variables.mdx`,
 * or be listed below as internal. A mention elsewhere in the docs isn't enough.
 * This is what keeps the reference from silently falling behind when a change
 * adds a new knob.
 */

/** Read by the app but not something anyone configures, so not documented. */
const INTERNAL: Record<string, string> = {
  NODE_ENV: "set by Node/Next",
  NEXT_PHASE: "set by Next during build",
  NEXT_RUNTIME: "set by Next per runtime",
  VERCEL: "injected by Vercel",
  VERCEL_BRANCH_URL: "injected by Vercel",
  VERCEL_URL: "injected by Vercel",
  PATH: "the host's search path, passed through to local workspaces",
  SHELL: "the user's login shell",
  NEXT_PUBLIC_SCREENPLAY_FIXTURE_WORLD: "screenshot harness fixture switch",
  PORTLESS_STATE_DIR: "mirrors the portless CLI's own override",
  SCREENPLAY_LISTEN_PORT: "set inside a sandbox by provisioning",
  SCREENPLAY_UPSTREAM_PORT: "set inside a sandbox by provisioning",
  SCREENPLAY_LISTEN_HOST: "set inside a sandbox by provisioning",
  SCREENPLAY_STREAM_PORT: "set inside a sandbox by the Frame Stream launch",
  SCREENPLAY_STREAM_HOST: "set inside a sandbox by the Frame Stream launch",
  SCREENPLAY_STREAM_KEY: "set inside a sandbox by the Frame Stream launch",
  SCREENPLAY_FRAME_ORIGIN: "set inside a sandbox by the Frame Stream launch",
  SCREENPLAY_CHROME: "set inside a sandbox by the Frame Stream launch",
  SCREENPLAY_STREAM_FPS: "Frame Stream tuning, defaulted in the service",
  SCREENPLAY_STREAM_SCALE: "Frame Stream tuning, defaulted in the service",
  SCREENPLAY_STREAM_MAX_PIXELS: "Frame Stream tuning, defaulted in the service",
  SCREENPLAY_STREAM_IDLE_MS: "Frame Stream tuning, defaulted in the service",
  SCREENPLAY_STREAM_MAX_FRAMES: "Frame Stream tuning, defaulted in the service",
  SCREENPLAY_STREAM_CODEC: "Frame Stream test switch (VP8 for test browsers)",
  SCREENPLAY_XTE: "Frame Stream test switch (xte path; empty sends CDP input)",
  SCREENPLAY_STREAM_DISPLAY: "Frame Stream test switch (first X display)",
  SCREENPLAY_SHELL_PID: "set by the desktop shell for its own watchdog",
}

const appRoot = fileURLToPath(new URL("../", import.meta.url))
const referencePage = path.join(
  appRoot,
  "../docs/content/self-hosting/environment-variables.mdx"
)

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

/** The variables with a row of their own: a first cell of just `NAME`. */
function documentedVars(): Set<string> {
  const rows = readFileSync(referencePage, "utf8").matchAll(
    /^\| `([A-Z][A-Z0-9_]*)` \|/gm
  )
  return new Set([...rows].map((m) => m[1]!))
}

describe("environment variable docs", () => {
  const read = envVarsReadByApp()
  const documented = documentedVars()

  it("finds the env vars the app reads", () => {
    expect(read.size).toBeGreaterThan(20)
  })

  it("documents every env var the app reads", () => {
    const undocumented = [...read]
      .filter((name) => !(name in INTERNAL))
      .filter((name) => !documented.has(name))
      .sort()
    // Add each to apps/docs/content/self-hosting/environment-variables.mdx,
    // or to INTERNAL above if it isn't something anyone sets.
    expect(undocumented).toEqual([])
  })

  it("lists no internal env var the app no longer reads", () => {
    expect(Object.keys(INTERNAL).filter((name) => !read.has(name))).toEqual([])
  })
})
