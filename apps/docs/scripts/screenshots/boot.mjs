// Boot Screenplay's local (desktop) build in a browser, with no Tauri shell and
// no external services, wired for deterministic docs screenshots:
//
//  - an isolated $HOME (git identity, a stand-in Claude Code login) under WORK_DIR
//  - the Northwind demo repo checked out at DEMO_DIR, with a bare "origin"
//  - `claude` / `npx` shims on PATH so naming and agent turns are scripted
//
// Usage: node boot.mjs [--fresh]   (--fresh wipes WORK_DIR first)
import { execFileSync, execSync, spawn } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import {
  APP_DIR,
  APP_PORT,
  APP_URL,
  DATA_DIR,
  DEMO_DIR,
  DEMO_REMOTE,
  FAKE_HOME,
  FIXTURES,
  LOG_DIR,
  WORK_DIR,
  chromePath,
  ensureDirs,
  sleep,
} from "./lib/env.mjs"
import { stopBrowser } from "./lib/browser.mjs"
import { killWorkspaceProcesses } from "./lib/cleanup.mjs"

const which = (bin) => {
  try {
    return execSync(`command -v ${bin}`, { encoding: "utf8" }).trim()
  } catch {
    return ""
  }
}

export async function appUp() {
  try {
    const r = await fetch(`${APP_URL}/api/health`)
    return r.ok
  } catch {
    return false
  }
}

function prepareHome() {
  fs.writeFileSync(
    path.join(FAKE_HOME, ".gitconfig"),
    "[user]\n\tname = Sam Rivera\n\temail = sam@northwind.dev\n[init]\n\tdefaultBranch = main\n"
  )
  // Screenplay's first-run gate checks for a signed-in coding CLI; this is the
  // file it reads for Claude Code (see probeClaudeCodeAuth).
  fs.writeFileSync(
    path.join(FAKE_HOME, ".claude.json"),
    JSON.stringify({ oauthAccount: { emailAddress: "sam@northwind.dev" }, hasCompletedOnboarding: false })
  )
}

// Marks a demo checkout as created by this tool, so --fresh may delete it.
const DEMO_MARKER = path.join(DEMO_DIR, ".git", "screenplay-docs-demo")

function prepareDemoRepo(env) {
  if (fs.existsSync(path.join(DEMO_DIR, ".git"))) return
  if (fs.existsSync(DEMO_DIR) && fs.readdirSync(DEMO_DIR).length)
    throw new Error(`${DEMO_DIR} exists and isn't a demo checkout — pick another DOCS_DEMO_DIR`)
  console.log(`• Creating demo repo at ${DEMO_DIR}`)
  fs.mkdirSync(DEMO_DIR, { recursive: true })
  fs.cpSync(path.join(FIXTURES, "demo-app"), DEMO_DIR, { recursive: true })
  const git = (...args) => execFileSync("git", args, { cwd: DEMO_DIR, env, stdio: "pipe" })
  git("init", "-q", "-b", "main")
  git("add", "-A")
  git("commit", "-qm", "Northwind marketing site")
  fs.mkdirSync(path.dirname(DEMO_REMOTE), { recursive: true })
  execFileSync("git", ["init", "-q", "--bare", DEMO_REMOTE], { env })
  git("remote", "add", "origin", DEMO_REMOTE)
  git("push", "-q", "-u", "origin", "main")
  fs.writeFileSync(DEMO_MARKER, "created by apps/docs/scripts/screenshots\n")
  console.log("• Installing demo dependencies (npm install)")
  execFileSync("npm", ["install", "--no-audit", "--no-fund"], { cwd: DEMO_DIR, env, stdio: "inherit" })
}

export async function boot({ fresh = false } = {}) {
  if (fresh) {
    stopApp()
    await stopBrowser()
    await sleep(2000)
    fs.rmSync(WORK_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
    // Only ever delete a demo checkout this tool created.
    if (fs.existsSync(DEMO_MARKER)) fs.rmSync(DEMO_DIR, { recursive: true, force: true })
  }
  ensureDirs()
  if (await appUp()) {
    console.log(`• App already running at ${APP_URL}`)
    return
  }
  prepareHome()

  const shims = path.join(FIXTURES, "bin")
  const env = {
    ...process.env,
    HOME: FAKE_HOME,
    PATH: `${shims}${path.delimiter}${process.env.PATH}`,
    DOCS_REAL_CLAUDE: which("claude"),
    DOCS_REAL_NPX: which("npx"),
    DOCS_CHROME: chromePath(),
    // The desktop build profile (apps/desktop/desktop.env), minus the Tauri bits.
    NEXT_PUBLIC_SCREENPLAY_LOCAL: "1",
    NEXT_PUBLIC_YJS_HOST: "local",
    NEXT_PUBLIC_BASE_PATH: "",
    SANDBOX_BACKEND: "local",
    SCREENPLAY_DB: "pglite",
    BLOB_STORE: "local-fs",
    AGENT_ENGINE: "external",
    PGLITE_DATA_DIR: path.join(DATA_DIR, "pglite"),
    YJS_PERSISTENCE_DIR: path.join(DATA_DIR, "yjs"),
    LOCAL_BLOB_DIR: path.join(DATA_DIR, "blobs"),
    LOCAL_BLOB_BASE_URL: `${APP_URL}/blobs`,
    SCREENPLAY_WORKTREE_ROOT: path.join(DATA_DIR, "worktrees"),
    ENCRYPTION_KEY: crypto.randomBytes(32).toString("hex"),
    TERMINAL_AUTH_SECRET: crypto.randomBytes(32).toString("hex"),
    PORT: String(APP_PORT),
  }
  // Headless thumbnail capture needs --no-sandbox when running as root.
  env.CHROMIUM_PATH =
    process.getuid?.() === 0 ? path.join(shims, "chromium-no-sandbox") : env.DOCS_CHROME

  prepareDemoRepo(env)

  console.log(`• Starting Screenplay (local build) on ${APP_URL} — log: ${LOG_DIR}/app.log`)
  const out = fs.openSync(path.join(LOG_DIR, "app.log"), "a")
  const child = spawn("npx", ["next", "dev", "--turbopack", "--port", String(APP_PORT)], {
    cwd: APP_DIR,
    env,
    detached: true,
    stdio: ["ignore", out, out],
  })
  child.unref()
  fs.writeFileSync(path.join(WORK_DIR, "app.pid"), String(child.pid))
  for (let i = 0; i < 180 && !(await appUp()); i++) await sleep(1000)
  if (!(await appUp())) throw new Error(`App didn't come up — see ${LOG_DIR}/app.log`)
  console.log("• App is up")
}

export function stopApp() {
  const pidFile = path.join(WORK_DIR, "app.pid")
  if (fs.existsSync(pidFile)) {
    const pid = Number(fs.readFileSync(pidFile, "utf8"))
    try {
      process.kill(-pid, "SIGTERM")
    } catch {}
    fs.rmSync(pidFile, { force: true })
  }
  // Workspace dev servers run in their own process groups with respawn loops,
  // so they outlive the app; stop the ones belonging to this run.
  const n = killWorkspaceProcesses()
  if (n) console.log(`• Stopped ${n} workspace sandbox(es)`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await boot({ fresh: process.argv.includes("--fresh") })
}
