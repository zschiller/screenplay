/**
 * `pnpm headless` (#1930): run Screenplay from this clone on a machine you
 * control. It checks the box, builds the app in production mode, and serves
 * it through the front server (`front-server.mjs`). It keeps no keep-alive:
 * rerun it after the box stops, and everything comes back from the data
 * folder.
 *
 *   pnpm headless              check, build, serve
 *   pnpm headless --no-build   serve the last build
 *
 * Run with tsx (and `register.mjs` for `server-only`), so it reads the config
 * file with the server's own checks.
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

import { hostHarnessOf } from "@/lib/agent/harnesses/coding-cli"
import { hostCatalog } from "@/lib/agent/harnesses"
import {
  CONFIG_ENV_VAR,
  ConfigError,
  createConfigured,
  loadConfig,
  type ScreenplayConfig,
} from "@/lib/extensions/config"
import { outboundProxyEnv } from "@/lib/network/outbound-proxy"
import { PORTLESS_PROXY_PORT } from "@/lib/sandbox/portless"

import { isOnPath, missingPrerequisites } from "./setup-check"

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const distDir = path.join(appDir, ".next", "headless")
const standaloneApp = path.join(distDir, "standalone", "apps", "app")

/** The host listener's port when the config names none. */
export const DEFAULT_HOST_PORT = 4100

function log(line: string): void {
  process.stdout.write(`[headless] ${line}\n`)
}

function fail(lines: string[]): never {
  for (const line of lines) process.stderr.write(`${line}\n`)
  process.exit(1)
}

/** The config file, or the defaults with the data folder in the home folder. */
function readConfig(): { config: ScreenplayConfig; dataFolder: string } {
  let config: ScreenplayConfig
  try {
    config = loadConfig()
  } catch (err) {
    if (err instanceof ConfigError) fail([err.message])
    throw err
  }
  const dataFolder = config.file
    ? config.dataFolder
    : path.join(os.homedir(), ".screenplay", "headless")
  return { config, dataFolder }
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

async function setupCheck(config: ScreenplayConfig): Promise<string | null> {
  const chrome = await findChrome()
  const codingClis = config.named.includes("codingCli")
    ? (await createConfigured("codingCli", config)).map(
        (cli) => hostHarnessOf(cli).hostBinary
      )
    : null
  const [github] = config.interfaces.githubAccess
  const command = (github?.options as { command?: string | string[] })?.command
  const githubCommand =
    github?.use === "gh-cli"
      ? ((Array.isArray(command) ? command[0] : command) ?? "gh")
      : null
  const missing = missingPrerequisites(
    {
      nodeVersion: process.versions.node,
      onPath: (c) => isOnPath(c),
      ptyBuilt: existsSync(ptyBuildDir()),
      chrome,
    },
    {
      codingClis,
      builtInClis: [...new Set(hostCatalog().map((h) => h.hostBinary))],
      githubCommand,
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
  // The front server itself.
  for (const file of ["front-server.mjs", "banner.mjs", "ws-routes.mjs"]) {
    mkdirSync(path.join(standaloneApp, "headless"), { recursive: true })
    cpSync(
      path.join(appDir, "headless", file),
      path.join(standaloneApp, "headless", file)
    )
  }
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
  config: ScreenplayConfig
  dataFolder: string
  hostPort: number
  portlessPort: number
  chrome: string | null
  secrets: { encryptionKey: string; terminalAuthSecret: string }
  appDir: string
}): Record<string, string> {
  const { config, dataFolder } = opts
  const folder = (name: string) => {
    const dir = path.join(dataFolder, name)
    mkdirSync(dir, { recursive: true })
    return dir
  }
  return {
    ...PROFILE_ENV,
    PORT: String(opts.hostPort),
    HOSTNAME: "127.0.0.1",
    ...(config.file && { [CONFIG_ENV_VAR]: config.file }),
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
    ...(config.outboundProxy && outboundProxyEnv(config.outboundProxy)),
    SCREENPLAY_PORTLESS_PORT: String(opts.portlessPort),
    SCREENPLAY_VIEWER_LISTENERS: JSON.stringify(
      config.listeners?.viewers ?? []
    ),
  }
}

async function main(): Promise<void> {
  const skipBuild = process.argv.includes("--no-build")
  const { config, dataFolder } = readConfig()
  mkdirSync(dataFolder, { recursive: true })
  log(`Data folder: ${dataFolder}`)
  const chrome = await setupCheck(config)

  if (!skipBuild) build()
  else if (!existsSync(path.join(standaloneApp, "server.js"))) {
    fail(["There’s no build yet; run pnpm headless without --no-build."])
  }

  const portlessPort = startPortless()
  const hostPort = config.listeners?.host?.port ?? DEFAULT_HOST_PORT
  const env = serverEnv({
    config,
    dataFolder,
    hostPort,
    portlessPort,
    chrome,
    secrets: loadSecrets(dataFolder),
    appDir: standaloneApp,
  })

  const server = spawn(
    process.execPath,
    [path.join(standaloneApp, "headless", "front-server.mjs")],
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
