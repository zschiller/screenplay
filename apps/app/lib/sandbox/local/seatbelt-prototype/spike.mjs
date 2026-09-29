// PROTOTYPE (issue #992), throwaway. Not imported by the app.
//
// Does a dev server still work inside the Seatbelt profile the isolation
// research picked? Run on a Mac from the repo root:
//
//   bash apps/app/lib/sandbox/local/seatbelt-prototype/run.sh
//
// It works under ~/.screenplay/seatbelt-992 (deleted and recreated each run),
// never touches the app's own state, and writes a Markdown report there.

import { execFileSync, spawn, spawnSync } from "node:child_process"
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import net from "node:net"
import { homedir, platform } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { LOG_TAG, makeProfile } from "./profile.mjs"

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, "../../../../../..")
const NORTHWIND = join(repo, "apps/app/screenshots/docs/northwind")
const PROXY = join(repo, "apps/app/lib/sandbox-bridge/proxy.mjs")

const args = new Set(process.argv.slice(2))
const onlyProbes = args.has("--probes-only")
const skipNext = args.has("--skip-next")

if (platform() !== "darwin" || !existsSync("/usr/bin/sandbox-exec")) {
  console.error("This spike needs macOS with /usr/bin/sandbox-exec.")
  process.exit(1)
}

const HOME = realpathSync(homedir())
mkdirSync(join(HOME, ".screenplay"), { recursive: true })
const WORK = join(HOME, ".screenplay/seatbelt-992")
rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })
const REPORT = join(WORK, "report.md")
const startedAt = new Date()

// Toolchain the sandbox may read inside $HOME: the node install (nvm, volta,
// fnm and friends all live under $HOME).
const nodePrefix = dirname(dirname(realpathSync(process.execPath)))
const toolchain = nodePrefix.startsWith(HOME + "/") ? [nodePrefix] : []
const npmCli = [join(nodePrefix, "lib/node_modules/npm/bin/npm-cli.js")].find((p) => existsSync(p))

const out = []
const say = (s = "") => {
  out.push(s)
  console.log(s)
}
const flush = () => writeFileSync(REPORT, out.join("\n") + "\n")

say(`## Seatbelt spike for #992`)
say()
say(`- macOS ${sh("sw_vers", ["-productVersion"])} (${sh("uname", ["-m"])}), node ${process.version} at \`${process.execPath.replace(HOME, "~")}\``)
say(`- Ran ${startedAt.toISOString()} from \`${sh("git", ["-C", repo, "rev-parse", "--short", "HEAD"])}\``)
say(`- Toolchain re-allowed for reads: ${toolchain.length ? toolchain.map((p) => "`" + p.replace(HOME, "~") + "`").join(", ") : "none (node lives outside $HOME)"}`)
say()

// ---------------------------------------------------------------------------
// Helpers

function sh(cmd, argv, opts = {}) {
  try {
    return execFileSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], ...opts }).trim()
  } catch {
    return "?"
  }
}

function freePort() {
  return new Promise((res) => {
    const s = net.createServer()
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address()
      s.close(() => res(port))
    })
  })
}

function decoy(name) {
  // Stands in for a host loopback service (terminal socket, Yjs). Anything
  // that connects gets logged.
  return new Promise((res) => {
    const hits = []
    const s = net.createServer((c) => {
      hits.push(Date.now())
      c.on("error", () => {})
      c.end(`${name} decoy\n`)
    })
    s.listen(0, "127.0.0.1", () => res({ port: s.address().port, hits, close: () => s.close() }))
  })
}

function sandboxDirs(name) {
  const worktree = join(WORK, "worktrees", name)
  const state = join(WORK, "state", name)
  for (const d of [worktree, join(state, "tmp"), join(state, "home"), join(state, "npm-cache")]) {
    mkdirSync(d, { recursive: true })
  }
  writeFileSync(join(state, "npmrc"), "")
  return { worktree: realpathSync(worktree), state: realpathSync(state) }
}

function sandboxEnv(state, extra = {}) {
  return {
    // This node first, so version-manager shims under $HOME (denied) aren't hit.
    PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
    // A private HOME: tools that read ~/.npmrc, ~/.gitconfig, caches and so on
    // get an empty one instead of the user's.
    HOME: join(state, "home"),
    TMPDIR: join(state, "tmp") + "/",
    npm_config_cache: join(state, "npm-cache"),
    npm_config_userconfig: join(state, "npmrc"),
    npm_config_update_notifier: "false",
    NEXT_TELEMETRY_DISABLED: "1",
    BROWSER: "none",
    FORCE_COLOR: "0",
    // Proxy, CA and registry settings, if any, pass through (the private HOME
    // hides ~/.npmrc).
    ...Object.fromEntries(
      Object.entries(process.env).filter(([k]) =>
        /^(https?_proxy|no_proxy|node_extra_ca_certs|ssl_cert_file|npm_config_(https?_proxy|noproxy|cafile|registry))$/i.test(k)
      )
    ),
    ...extra,
  }
}

function writeProfile(state, label, opts) {
  const file = join(state, `${label}.sb`)
  writeFileSync(file, makeProfile({ home: HOME, stateDir: state, readOnly: toolchain, ...opts }))
  return file
}

function sandboxSpawn(profile, cmd, argv, { cwd, env, log }) {
  const child = spawn("/usr/bin/sandbox-exec", ["-f", profile, cmd, ...argv], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  })
  if (log) {
    child.stdout.on("data", (d) => appendFileSync(log, d))
    child.stderr.on("data", (d) => appendFileSync(log, d))
  }
  return child
}

function killGroup(child) {
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitHttp(url, ms) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) })
      if (r.status < 500) return { ok: true, status: r.status, ms: Date.now() - t0, body: await r.text() }
    } catch {}
    await sleep(500)
  }
  return { ok: false, ms }
}

function violations(sinceDate) {
  // The kernel logs every denial with our tag. Summarize the distinct ones.
  const secs = Math.ceil((Date.now() - sinceDate.getTime()) / 1000) + 5
  const raw = sh("/usr/bin/log", [
    "show",
    "--last",
    `${secs}s`,
    "--style",
    "compact",
    "--predicate",
    `eventMessage CONTAINS "${LOG_TAG}"`,
  ], { maxBuffer: 64 * 1024 * 1024 })
  const counts = new Map()
  for (const line of raw.split("\n")) {
    const m = line.match(/Sandbox: ([^(]+)\(\d+\) (deny\(\d+\) .*)$/)
    if (!m) continue
    const what = m[2].replace(/deny\(\d+\) /, "").replace(LOG_TAG, "").replace(HOME, "~").trim()
    const key = `${m[1]}: ${what.slice(0, 160)}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
}

function mark(ok, expectOk) {
  if (expectOk === undefined) return ok ? "allowed" : "blocked"
  return ok === expectOk ? (ok ? "✅ allowed" : "✅ blocked") : ok ? "❌ ALLOWED" : "❌ BLOCKED"
}

// ---------------------------------------------------------------------------
// Part 1: probes (a hostile dev server's view)

async function runProbes() {
  say(`### 1. What a sandboxed process can reach`)
  say()
  say(`Each column runs \`probe-inside.mjs\` under a different profile. "unsandboxed" is the control: it shows what exists on this Mac. The keychain control may pop a keychain prompt; either answer is fine.`)
  say()

  const terminal = await decoy("terminal-socket")
  const yjs = await decoy("yjs")
  const { worktree, state } = sandboxDirs("probe")
  copyFileSync(join(here, "probe-inside.mjs"), join(worktree, "probe-inside.mjs"))
  writeFileSync(join(worktree, "package.json"), "{}\n")
  sh("git", ["-C", worktree, "init", "-q"])

  const devPort = await freePort()
  const otherPort = await freePort()
  const cfg = {
    home: HOME,
    worktree,
    devPort,
    otherPort,
    decoys: { "terminal socket stand-in": terminal.port, "Yjs stand-in": yjs.port },
    sshAuthSock: process.env.SSH_AUTH_SOCK || "",
    watch: true,
  }

  const columns = [
    ["unsandboxed", null],
    ["dev", { mode: "dev", devPort, worktree }],
    ["dev + FSEvents", { mode: "dev", devPort, worktree, fsevents: true }],
    ["install", { mode: "install", worktree }],
    ["srt-like (keychain + any loopback)", { mode: "dev", devPort, worktree, fsevents: true, keychain: true, anyLoopback: true }],
  ]

  // What we want the Screenplay "dev" profile to do.
  const expectDev = (k) =>
    k.startsWith("write in worktree") || k.startsWith("read in worktree") || k.startsWith("git status") ||
    k.startsWith(`bind dev port`) || k.startsWith("fs.watch")

  const table = new Map()
  for (const [label, opts] of columns) {
    // Progress on stderr only (not the report): each column takes ~10s and the
    // table prints at the end, so without this the run looks stuck.
    process.stderr.write(`  probing: ${label}…\n`)
    let child
    if (!opts) {
      child = spawn(process.execPath, [join(worktree, "probe-inside.mjs"), JSON.stringify(cfg)], {
        cwd: worktree,
        stdio: ["ignore", "pipe", "pipe"],
      })
    } else {
      const profile = writeProfile(state, label.replace(/\W+/g, "-"), opts)
      child = spawn("/usr/bin/sandbox-exec", ["-f", profile, process.execPath, join(worktree, "probe-inside.mjs"), JSON.stringify(cfg)], {
        cwd: worktree,
        env: sandboxEnv(state),
        stdio: ["ignore", "pipe", "pipe"],
      })
    }
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d) => (stdout += d))
    child.stderr.on("data", (d) => {
      stderr += d
      if (String(d).includes("WATCHING")) {
        setTimeout(() => writeFileSync(join(worktree, "watch-probe", `edit-${Date.now()}.txt`), "x"), 700)
      }
    })
    const code = await new Promise((r) => child.on("close", r))
    let res = {}
    try {
      res = JSON.parse(stdout)
    } catch {
      res = { "probe did not run": { ok: false, detail: `exit ${code}: ${stderr.trim().split("\n").slice(-3).join(" | ")}` } }
    }
    for (const [k, v] of Object.entries(res)) {
      if (!table.has(k)) table.set(k, {})
      table.get(k)[label] = { ...v, expect: label.startsWith("dev") ? expectDev(k) : undefined }
    }
  }
  rmSync(join(HOME, "screenplay-992-canary"), { force: true })

  say(`| Probe | ${columns.map((c) => c[0]).join(" | ")} |`)
  say(`|---|${columns.map(() => "---").join("|")}|`)
  for (const [k, row] of table) {
    const cells = columns.map(([label]) => {
      const c = row[label]
      if (!c) return "–"
      if (c.detail === "ENOENT") return "not on this Mac"
      return `${mark(c.ok, c.expect)} <sub>${String(c.detail).replace(/\|/g, "/").slice(0, 60)}</sub>`
    })
    say(`| ${k} | ${cells.join(" | ")} |`)
  }
  say()
  say(`Decoy hits (connections that actually landed): terminal stand-in ${terminal.hits.length}, Yjs stand-in ${yjs.hits.length}. The unsandboxed and srt-like columns are expected to account for them.`)
  say()
  terminal.close()
  yjs.close()
  flush()
}

// ---------------------------------------------------------------------------
// Part 2: real dev servers

const APPS = {
  northwind: {
    title: "Demo site (Northwind, Vite + React)",
    setup(dir) {
      cpSync(NORTHWIND, dir, { recursive: true })
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify(
          {
            name: "northwind-web",
            private: true,
            type: "module",
            scripts: { dev: "vite" },
            dependencies: {
              "@fontsource-variable/inter": "^5.0.0",
              "@screenplay.space/knobs": "^0.1.4",
              "@screenplay.space/state": "^0.1.3",
              react: "^19.1.0",
              "react-dom": "^19.1.0",
            },
            devDependencies: { "@vitejs/plugin-react": "^5.0.0", vite: "^7.0.0" },
          },
          null,
          2
        )
      )
      writeFileSync(
        join(dir, "vite.config.js"),
        `import react from "@vitejs/plugin-react"\nexport default { plugins: [react()] }\n`
      )
    },
    dev: (port) => ["node_modules/vite/bin/vite.js", "--port", String(port), "--strictPort", "--host", "127.0.0.1"],
    editFile: "src/App.jsx",
    edit: (src, marker) => `${src}\nconsole.debug(${JSON.stringify(marker)})\n`,
    warm: "/src/App.jsx",
  },
  next: {
    title: "Next.js app (next dev, Turbopack)",
    setup(dir) {
      mkdirSync(join(dir, "app"), { recursive: true })
      writeFileSync(
        join(dir, "package.json"),
        JSON.stringify(
          {
            name: "next-probe",
            private: true,
            scripts: { dev: "next dev" },
            dependencies: { next: "^16.0.0", react: "^19.1.0", "react-dom": "^19.1.0" },
          },
          null,
          2
        )
      )
      writeFileSync(
        join(dir, "app/layout.jsx"),
        `export default function Layout({ children }) {\n  return <html><body>{children}</body></html>\n}\n`
      )
      writeFileSync(
        join(dir, "app/page.jsx"),
        `export default function Page() {\n  return <h1>seatbelt probe</h1>\n}\n`
      )
    },
    dev: (port) => ["node_modules/next/dist/bin/next", "dev", "-p", String(port), "-H", "127.0.0.1"],
    editFile: "app/page.jsx",
    edit: (src, marker) => src.replace(/seatbelt( probe|-hmr-\d+)/, marker),
    warm: "/",
  },
}

async function runApp(key) {
  const app = APPS[key]
  say(`### 2${key === "northwind" ? "a" : "b"}. ${app.title}`)
  say()
  const { worktree, state } = sandboxDirs(key)
  app.setup(worktree)
  writeFileSync(join(worktree, ".gitignore"), "node_modules\n.next\ndist\n")
  sh("git", ["-C", worktree, "init", "-q", "-b", "main"])
  sh("git", ["-C", worktree, "add", "-A"])
  sh("git", ["-C", worktree, "-c", "user.name=spike", "-c", "user.email=spike@example.com", "commit", "-qm", "init"])

  // Install (the setup script), sandboxed.
  const since = new Date()
  const installLog = join(state, "install.log")
  const installProfile = writeProfile(state, "install", { mode: "install", worktree })
  const t0 = Date.now()
  process.stderr.write(`  npm install (sandboxed)…\n`)
  const npm = spawnSync(
    "/usr/bin/sandbox-exec",
    npmCli
      ? ["-f", installProfile, process.execPath, npmCli, "install", "--no-audit", "--no-fund", "--loglevel=error"]
      : ["-f", installProfile, "sh", "-c", "npm install --no-audit --no-fund --loglevel=error"],
    { cwd: worktree, env: sandboxEnv(state), encoding: "utf8", timeout: 600000 }
  )
  writeFileSync(installLog, (npm.stdout || "") + (npm.stderr || ""))
  const installed = npm.status === 0
  say(`- **Install** (sandboxed \`npm install\`, install profile): ${installed ? "✅" : "❌"} exit ${npm.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  if (!installed) {
    say("  ```")
    for (const l of ((npm.stderr || "") + (npm.stdout || "")).trim().split("\n").slice(-12)) say("  " + l)
    say("  ```")
  }
  const installDenials = violations(since)
  if (installDenials.length) {
    say(`  <details><summary>Sandbox denials during install (${installDenials.length} distinct)</summary>\n`)
    for (const [k, n] of installDenials.slice(0, 40)) say(`  - ${n}× \`${k}\``)
    say(`  </details>`)
  }
  if (!installed) {
    say(`- Skipping dev server: install failed. Log: \`${installLog.replace(HOME, "~")}\``)
    say()
    flush()
    return
  }

  for (const fsevents of [false, true]) {
    await runDev(app, worktree, state, fsevents)
  }
  say()
  flush()
}

async function runDev(app, worktree, state, fsevents) {
  const label = fsevents ? "dev + FSEvents" : "dev"
  const since = new Date()
  const devPort = await freePort()
  const proxyPort = await freePort()
  const log = join(state, `${label.replace(/\W+/g, "-")}.log`)
  writeFileSync(log, "")
  const profile = writeProfile(state, label.replace(/\W+/g, "-"), { mode: "dev", worktree, devPort, fsevents })
  const dev = sandboxSpawn(profile, process.execPath, app.dev(devPort), { cwd: worktree, env: sandboxEnv(state), log })
  const proxy = spawn(process.execPath, [PROXY], {
    env: { ...process.env, SCREENPLAY_UPSTREAM_PORT: String(devPort), SCREENPLAY_LISTEN_PORT: String(proxyPort) },
    stdio: "ignore",
    detached: true,
  })
  const rows = []
  const row = (name, ok, detail) => rows.push(`| ${name} | ${ok ? "✅" : "❌"} | ${String(detail).replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 160)} |`)

  try {
    const up = await waitHttp(`http://127.0.0.1:${devPort}${app.warm}`, 120000)
    row("Starts (direct)", up.ok, up.ok ? `HTTP ${up.status} after ${(up.ms / 1000).toFixed(1)}s` : `no answer in ${up.ms / 1000}s`)
    if (!up.ok) return

    const viaProxy = await waitHttp(`http://127.0.0.1:${proxyPort}/`, 30000)
    const bridged = viaProxy.ok && /data-screenplay-bridge/.test(viaProxy.body || "")
    row("Loads through the bridge proxy", bridged, viaProxy.ok ? `HTTP ${viaProxy.status}, bridge tag ${bridged ? "injected" : "missing"}` : "no answer")

    // HMR socket through the proxy, then an edit from the host (the agent
    // edits files outside the sandbox).
    const messages = []
    let wsUrl
    let proto
    if (app === APPS.northwind) {
      const client = await (await fetch(`http://127.0.0.1:${proxyPort}/@vite/client`)).text()
      const token = client.match(/wsToken\s*=\s*"([^"]*)"/)?.[1] ?? ""
      if (!token) row("Vite HMR token found in /@vite/client", false, "regex missed; the socket check below will likely fail for that reason")
      wsUrl = `ws://127.0.0.1:${proxyPort}/?token=${encodeURIComponent(token)}`
      proto = "vite-hmr"
    } else {
      // Next 16 moved the HMR socket from /_next/webpack-hmr to /_next/hmr.
      wsUrl = `ws://127.0.0.1:${proxyPort}/_next/hmr?id=seatbelt-spike`
    }
    const ws = proto ? new WebSocket(wsUrl, proto) : new WebSocket(wsUrl)
    const opened = await new Promise((r) => {
      ws.onopen = () => r(true)
      ws.onerror = () => r(false)
      setTimeout(() => r(false), 15000)
    })
    ws.onmessage = (e) => messages.push({ at: Date.now(), data: String(e.data) })
    row("HMR socket opens through the proxy", opened, wsUrl.replace(/token=[^&]+/, "token=…"))
    await sleep(2000)

    const marker = `seatbelt-hmr-${Date.now()}`
    const file = join(worktree, app.editFile)
    const editedAt = Date.now()
    writeFileSync(file, app.edit(readFileSync(file, "utf8"), marker))
    // Wait for the watcher to act.
    let hmrMsg
    for (let i = 0; i < 30 && !hmrMsg; i++) {
      await sleep(500)
      hmrMsg = messages.find((m) => m.at >= editedAt && !/"(ping|pong)"|^\{"type":"(ping|connected)"\}$/.test(m.data))
    }
    row(
      "HMR message after a host edit",
      !!hmrMsg,
      hmrMsg ? `after ${((hmrMsg.at - editedAt) / 1000).toFixed(1)}s: ${hmrMsg.data.slice(0, 100)}` : `none in 15s (${messages.length} messages total)`
    )
    const after = await waitHttp(`http://127.0.0.1:${devPort}${app.warm}`, 30000)
    row("Serves the edited source", !!after.body?.includes(marker), after.body?.includes(marker) ? "marker found" : "old source still served")
    ws.close()
  } finally {
    killGroup(dev)
    killGroup(proxy)
    await sleep(1000)
    say(`**${label}** (log: \`${log.replace(HOME, "~")}\`)`)
    say()
    say(`| Check | | Detail |`)
    say(`|---|---|---|`)
    for (const r of rows) say(r)
    const denials = violations(since)
    if (denials.length) {
      say()
      say(`<details><summary>Sandbox denials while it ran (${denials.length} distinct)</summary>\n`)
      for (const [k, n] of denials.slice(0, 40)) say(`- ${n}× \`${k}\``)
      say(`</details>`)
    }
    say()
    const tail = readFileSync(log, "utf8").trim().split("\n").slice(-8)
    if (rows.some((r) => r.includes("❌"))) {
      say("Last lines of the dev server log:")
      say("```")
      for (const l of tail) say(l)
      say("```")
      say()
    }
    flush()
  }
}

// ---------------------------------------------------------------------------

await runProbes()
if (!onlyProbes) {
  await runApp("northwind")
  if (!skipNext) await runApp("next")
}
say(`_Finished in ${((Date.now() - startedAt.getTime()) / 1000).toFixed(0)}s. Report: \`${REPORT.replace(HOME, "~")}\`_`)
flush()
console.log(`\nReport written to ${REPORT}`)
