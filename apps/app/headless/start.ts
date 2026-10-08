/**
 * `pnpm headless` (#1930): run Screenplay from this clone on a machine you
 * control. It checks the box, builds the app in production mode, and serves
 * it through the front server (`server/front-server.mjs`). It keeps no keep-alive:
 * rerun it after the box stops, and everything comes back from the data
 * folder.
 *
 *   pnpm headless              check, build, serve
 *   pnpm headless --no-build   serve the last build
 *
 * Run with tsx (and `register.mjs` for `server-only` and the profile), so its
 * setup check asks the server's own select modules what the server will run.
 */

import { execFileSync, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { HARNESSES } from "@/lib/agent/harnesses"
import { selectCodingClis } from "@/lib/agent/harnesses/coding-cli"
import { selectGitHubAccess } from "@/lib/github-access"
import { GH_CLI_ID } from "@/lib/github-access/gh-cli"
import { PORTLESS_PROXY_PORT } from "@/lib/sandbox/portless"

import { isOnPath, missingPrerequisites } from "./setup-check"

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const distDir = path.join(appDir, ".next", "headless")
const standaloneApp = path.join(distDir, "standalone", "apps", "app")

/** The host listener's port when `SCREENPLAY_HOST_PORT` is unset. */
export const DEFAULT_HOST_PORT = 4100

function log(line: string): void {
  process.stdout.write(`[headless] ${line}\n`)
}

function fail(lines: string[]): never {
  for (const line of lines) process.stderr.write(`${line}\n`)
  process.exit(1)
}

/** Where Screenplay keeps its data: `SCREENPLAY_DATA_FOLDER`, else the home folder's. */
export function dataFolderOf(
  env: Record<string, string | undefined> = process.env
): string {
  const configured = env.SCREENPLAY_DATA_FOLDER
  return configured
    ? path.resolve(configured)
    : path.join(os.homedir(), ".screenplay", "headless")
}

/** The host listener's port: `SCREENPLAY_HOST_PORT`, else {@link DEFAULT_HOST_PORT}. */
export function hostPortOf(
  env: Record<string, string | undefined> = process.env
): number {
  const configured = env.SCREENPLAY_HOST_PORT
  if (!configured) return DEFAULT_HOST_PORT
  const port = Number(configured)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail([`SCREENPLAY_HOST_PORT must be a port number, not "${configured}".`])
  }
  return port
}

/** The Chrome thumbnails would launch, or null. */
async function findChrome(): Promise<string | null> {
  const configured = process.env.CHROMIUM_PATH
  if (configured) return existsSync(configured) ? configured : null
  try {
    const puppeteer = (await import("puppeteer")).default
    const found = await puppeteer.executablePath()
    return existsSync(found) ? found : null
  } catch {
    return null
  }
}

async function setupCheck(): Promise<string | null> {
  const chrome = await findChrome()
  let codingClis: string[] | null
  let needsGh: boolean
  try {
    codingClis = selectCodingClis()?.map((cli) => cli.hostBinary) ?? null
    needsGh = selectGitHubAccess().id === GH_CLI_ID
  } catch (err) {
    fail([
      `Screenplay won’t start: ${err instanceof Error ? err.message : err}`,
    ])
  }
  const missing = missingPrerequisites(
    {
      nodeVersion: process.versions.node,
      onPath: (c) => isOnPath(c),
      ptyBuilt: existsSync(ptyBuildDir()),
      chrome,
    },
    {
      codingClis,
      builtInClis: [...new Set(HARNESSES.map((h) => h.hostBinary))],
      needsGh,
    }
  )
  if (missing.length > 0) {
    fail([
      "Screenplay can’t run on this machine yet. Missing:",
      ...missing.map((m) => `  - ${m}`),
    ])
  }
  return chrome
}

/** node-pty's native build output, in the app's installed copy. */
function ptyBuildDir(): string {
  return path.join(appDir, "node_modules", "node-pty", "build", "Release")
}

/** Per-install secrets, minted once and kept in the data folder (like the Mac app's). */
export function loadSecrets(dataFolder: string): {
  encryptionKey: string
  terminalAuthSecret: string
} {
  const file = path.join(dataFolder, "secrets.json")
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"))
    if (saved.encryptionKey && saved.terminalAuthSecret) return saved
  } catch {
    // First run: mint them below.
  }
  const secrets = {
    encryptionKey: randomBytes(32).toString("hex"),
    terminalAuthSecret: randomBytes(32).toString("hex"),
  }
  writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 })
  return secrets
}

/** What `next build` and the server share: the Headless profile. */
const PROFILE_ENV = {
  NEXT_PUBLIC_SCREENPLAY_PROFILE: "headless",
  // Served at the origin root; overrides a developer's `.env.local`.
  NEXT_PUBLIC_BASE_PATH: "",
}

function build(): void {
  log("Building in production mode…")
  const scratch = path.join(distDir, ".build-pglite")
  execFileSync(
    process.execPath,
    [path.join(appDir, "node_modules", "next", "dist", "bin", "next"), "build"],
    {
      cwd: appDir,
      stdio: "inherit",
      env: {
        ...process.env,
        ...PROFILE_ENV,
        // PGlite opens at module load during the build's data collection;
        // keep it off the real data folder.
        PGLITE_DATA_DIR: scratch,
      },
    }
  )
  rmSync(scratch, { recursive: true, force: true })
  if (!existsSync(path.join(standaloneApp, "server.js"))) {
    fail(["The build made no standalone server; see the output above."])
  }

  // What tracing leaves out of the standalone tree (as the Mac app's
  // `build-sidecar.mjs` adds them).
  cpSync(
    path.join(distDir, "static"),
    path.join(standaloneApp, ".next", "headless", "static"),
    { recursive: true }
  )
  if (existsSync(path.join(appDir, "public"))) {
    cpSync(path.join(appDir, "public"), path.join(standaloneApp, "public"), {
      recursive: true,
    })
  }
  // Read from disk, not imported: every migration set PGlite may run.
  cpSync(path.join(appDir, "drizzle"), path.join(standaloneApp, "drizzle"), {
    recursive: true,
  })
  // node-pty's native build, loaded dynamically, so tracing misses it.
  const pty = standalonePtyDir()
  cpSync(ptyBuildDir(), path.join(pty, "build", "Release"), {
    recursive: true,
  })
  // Spawned as a CLI, never imported.
  cpSync(
    path.join(appDir, "node_modules", "portless"),
    path.join(standaloneApp, "node_modules", "portless"),
    { recursive: true, dereference: true }
  )
  // The front server itself, and the banner it prints.
  cpSync(path.join(appDir, "server"), path.join(standaloneApp, "server"), {
    recursive: true,
    filter: (file) => !file.endsWith(".test.ts"),
  })
  mkdirSync(path.join(standaloneApp, "headless"), { recursive: true })
  cpSync(
    path.join(appDir, "headless", "banner.mjs"),
    path.join(standaloneApp, "headless", "banner.mjs")
  )
  log("Built.")
}

/** The node-pty package inside the standalone tree. */
function standalonePtyDir(): string {
  const pnpmDir = path.join(distDir, "standalone", "node_modules", ".pnpm")
  const entry = readdirSync(pnpmDir).find((d) => d.startsWith("node-pty@"))
  if (!entry) fail(["The build left node-pty out of the standalone server."])
  return path.join(pnpmDir, entry, "node_modules", "node-pty")
}

/** Start portless's proxy, which serves the host's frames, and read its port. */
function startPortless(): number {
  execFileSync(
    process.execPath,
    [
      path.join(appDir, "node_modules", "portless", "dist", "cli.js"),
      "proxy",
      "start",
      "--no-tls",
      "--port",
      String(PORTLESS_PROXY_PORT),
    ],
    { stdio: "ignore" }
  )
  const stateDir =
    process.env.PORTLESS_STATE_DIR ?? path.join(os.homedir(), ".portless")
  try {
    const port = parseInt(
      readFileSync(path.join(stateDir, "proxy.port"), "utf8"),
      10
    )
    if (!Number.isNaN(port)) return port
  } catch {
    // Fall back to the port asked for.
  }
  return PORTLESS_PROXY_PORT
}

/** Everything the server process runs with. */
export function serverEnv(opts: {
  dataFolder: string
  hostPort: number
  portlessPort: number
  chrome: string | null
  secrets: { encryptionKey: string; terminalAuthSecret: string }
  appDir: string
}): Record<string, string> {
  const { dataFolder } = opts
  const folder = (name: string) => {
    const dir = path.join(dataFolder, name)
    mkdirSync(dir, { recursive: true })
    return dir
  }
  return {
    ...PROFILE_ENV,
    PORT: String(opts.hostPort),
    HOSTNAME: "127.0.0.1",
    // Everything restart-safe lives in the data folder.
    PGLITE_DATA_DIR: folder("pglite"),
    PGLITE_MIGRATIONS_DIR: path.join(opts.appDir, "drizzle"),
    YJS_PERSISTENCE_DIR: folder("yjs"),
    LOCAL_BLOB_DIR: folder("blobs"),
    LOCAL_FILES_DIR: folder("files"),
    SCREENPLAY_COORDINATOR_ROOT: folder("coordinator"),
    SCREENPLAY_WORKTREE_ROOT: folder("worktrees"),
    // Origin-relative, so saved thumbnail URLs survive a port change.
    LOCAL_BLOB_BASE_URL: "/blobs",
    BETTER_AUTH_URL: `http://127.0.0.1:${opts.hostPort}`,
    ENCRYPTION_KEY: opts.secrets.encryptionKey,
    TERMINAL_AUTH_SECRET: opts.secrets.terminalAuthSecret,
    ...(opts.chrome && { CHROMIUM_PATH: opts.chrome }),
    SCREENPLAY_PORTLESS_PORT: String(opts.portlessPort),
  }
}

async function main(): Promise<void> {
  const skipBuild = process.argv.includes("--no-build")
  const dataFolder = dataFolderOf()
  const hostPort = hostPortOf()
  mkdirSync(dataFolder, { recursive: true })
  log(`Data folder: ${dataFolder}`)
  const chrome = await setupCheck()

  if (!skipBuild) build()
  else if (!existsSync(path.join(standaloneApp, "server.js"))) {
    fail(["There’s no build yet; run pnpm headless without --no-build."])
  }

  const portlessPort = startPortless()
  const env = serverEnv({
    dataFolder,
    hostPort,
    portlessPort,
    chrome,
    secrets: loadSecrets(dataFolder),
    appDir: standaloneApp,
  })

  const server = spawn(
    process.execPath,
    [path.join(standaloneApp, "server", "front-server.mjs")],
    {
      cwd: standaloneApp,
      stdio: "inherit",
      env: { ...process.env, ...env },
    }
  )
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => server.kill(signal))
  }
  server.on("exit", (code, signal) => {
    process.exit(code ?? (signal ? 1 : 0))
  })
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
