// Shared configuration for the docs screenshot tooling. Everything the
// pipeline creates lives under WORK_DIR, so a run never touches your real home
// directory, Screenplay data, or git config.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

export const TOOL_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const REPO_ROOT = path.resolve(TOOL_DIR, "../../../..")
export const APP_DIR = path.join(REPO_ROOT, "apps/app")
export const DOCS_PUBLIC = path.join(REPO_ROOT, "apps/docs/public/screenshots")
export const FIXTURES = path.join(TOOL_DIR, "fixtures")

/** Scratch root for this run (app data, fake $HOME, raw captures, state). */
export const WORK_DIR = path.resolve(
  process.env.DOCS_SHOTS_DIR ?? path.join(os.tmpdir(), "screenplay-docs-shots")
)
export const FAKE_HOME = path.join(WORK_DIR, "home")
export const DATA_DIR = path.join(WORK_DIR, "data")
export const RAW_DIR = path.join(WORK_DIR, "raw")
export const LOG_DIR = path.join(WORK_DIR, "logs")
export const STATE_FILE = path.join(WORK_DIR, "state.json")

/**
 * Where the demo project is checked out. The path appears in screenshots
 * (Settings → Project presets), so pick something that reads naturally, e.g.
 * `DOCS_DEMO_DIR=/Users/sam/code/northwind-web`.
 */
export const DEMO_DIR = path.resolve(
  process.env.DOCS_DEMO_DIR ?? path.join(WORK_DIR, "code", "northwind-web")
)
/** Bare repo the demo pushes to, so the agent's `git push` succeeds. */
export const DEMO_REMOTE = path.join(WORK_DIR, "remotes", "northwind-web.git")

export const APP_PORT = Number(process.env.DOCS_APP_PORT ?? 3000)
export const APP_URL = `http://localhost:${APP_PORT}`
export const CDP_PORT = Number(process.env.DOCS_CDP_PORT ?? 9222)

/** Capture viewport, in CSS px. Frame regions in `manifest.json` use this space. */
export const VIEWPORT = { width: 1280, height: 800 }

/** Resolve a dependency from `apps/app` so this tool adds no dependencies of its own. */
export const appRequire = createRequire(path.join(APP_DIR, "package.json"))

export function ensureDirs() {
  for (const d of [WORK_DIR, FAKE_HOME, DATA_DIR, RAW_DIR, LOG_DIR])
    fs.mkdirSync(d, { recursive: true })
}

export function readState() {
  return fs.existsSync(STATE_FILE)
    ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8"))
    : {}
}

export function writeState(patch) {
  const next = { ...readState(), ...patch }
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2))
  return next
}

/** Find a Chrome/Chromium binary: $CHROME_PATH, common installs, then Puppeteer's. */
export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]
  const pw = "/opt/pw-browsers"
  if (fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)))
      candidates.push(path.join(pw, d, "chrome-linux", "chrome"))
  }
  const hit = candidates.find((c) => fs.existsSync(c))
  if (hit) return hit
  try {
    return appRequire("puppeteer").executablePath()
  } catch {
    throw new Error("No Chrome found — set CHROME_PATH to a Chrome/Chromium binary.")
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
