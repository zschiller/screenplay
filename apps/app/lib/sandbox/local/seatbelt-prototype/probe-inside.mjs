// PROTOTYPE (issue #992), throwaway. Runs INSIDE the sandbox and tries the
// things a hostile dev server would. Prints one JSON object on stdout.
// Never prints secrets: for the keychain it reports only whether a value came
// back, and its length.
//
// argv: <json config> { home, worktree, devPort, otherPort, decoys: {name: port}, sshAuthSock }

import { spawnSync } from "node:child_process"
import { mkdirSync, readdirSync, readFileSync, watch, writeFileSync } from "node:fs"
import net from "node:net"
import { join } from "node:path"

const cfg = JSON.parse(process.argv[2])
const results = {}

function tryFs(name, fn) {
  try {
    const v = fn()
    results[name] = { ok: true, detail: v ?? "" }
  } catch (e) {
    results[name] = { ok: false, detail: e.code || e.message }
  }
}

function connect(opts, ms = 3000) {
  return new Promise((resolve) => {
    const s = net.connect(opts)
    const t = setTimeout(() => {
      s.destroy()
      resolve({ ok: false, detail: "timeout" })
    }, ms)
    s.once("connect", () => {
      clearTimeout(t)
      s.destroy()
      resolve({ ok: true, detail: "connected" })
    })
    s.once("error", (e) => {
      clearTimeout(t)
      resolve({ ok: false, detail: e.code || e.message })
    })
  })
}

function listen(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once("error", (e) => resolve({ ok: false, detail: e.code || e.message }))
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve({ ok: true, detail: "bound" })))
  })
}

// Files
tryFs("read ~/.ssh (list)", () => readdirSync(join(cfg.home, ".ssh")).length + " entries")
tryFs("read ~/.ssh/known_hosts", () => readFileSync(join(cfg.home, ".ssh/known_hosts")).length + " bytes")
tryFs("read ~/.config/gh/hosts.yml", () => readFileSync(join(cfg.home, ".config/gh/hosts.yml")).length + " bytes")
tryFs("read ~/.gitconfig", () => readFileSync(join(cfg.home, ".gitconfig")).length + " bytes")
tryFs("read ~/Library/Keychains (list)", () => readdirSync(join(cfg.home, "Library/Keychains")).length + " entries")
tryFs("write ~/screenplay-992-canary", () => writeFileSync(join(cfg.home, "screenplay-992-canary"), "x"))
tryFs("write in worktree", () => writeFileSync(join(cfg.worktree, ".probe-write"), "x"))
tryFs("read in worktree", () => readFileSync(join(cfg.worktree, "package.json")).length + " bytes")

// Keychain: the `gh` token. -w prints the secret; we only keep its length.
{
  const r = spawnSync("/usr/bin/security", ["find-generic-password", "-s", "gh:github.com", "-w"], {
    encoding: "utf8",
    timeout: 20000,
  })
  const len = (r.stdout || "").trim().length
  results["keychain: gh token"] = {
    ok: r.status === 0 && len > 0,
    detail: r.status === 0 ? `returned a ${len}-char secret` : `exit ${r.status}: ${(r.stderr || r.error?.code || "").trim().split("\n")[0]}`,
  }
}

// git in the worktree (dev tools shell out to it)
{
  const r = spawnSync("git", ["-C", cfg.worktree, "status", "--porcelain"], { encoding: "utf8", timeout: 20000 })
  results["git status in worktree"] = { ok: r.status === 0, detail: r.status === 0 ? "ok" : (r.stderr || "").trim().split("\n")[0] }
}

// Network: bind
results[`bind dev port ${cfg.devPort}`] = await listen(cfg.devPort)
results[`bind other port ${cfg.otherPort}`] = await listen(cfg.otherPort)

// Network: loopback services the host runs
for (const [name, port] of Object.entries(cfg.decoys)) {
  results[`connect 127.0.0.1:${port} (${name})`] = await connect({ host: "127.0.0.1", port })
}
results["connect 127.0.0.1:1234 (real Yjs, if app running)"] = await connect({ host: "127.0.0.1", port: 1234 })
if (cfg.sshAuthSock) results["connect ssh-agent socket"] = await connect({ path: cfg.sshAuthSock })

// Network: egress
results["connect 1.1.1.1:443"] = await connect({ host: "1.1.1.1", port: 443 })
results["connect registry.npmjs.org:443 (DNS+egress)"] = await connect({ host: "registry.npmjs.org", port: 443 })

// File watching (libuv fs.watch on a directory uses FSEvents on macOS).
// The host touches cfg.watchFile after we print "WATCHING".
if (cfg.watch) {
  const dir = join(cfg.worktree, "watch-probe")
  mkdirSync(dir, { recursive: true })
  results["fs.watch (FSEvents) sees host edit"] = await new Promise((resolve) => {
    let w
    try {
      w = watch(dir, { recursive: true }, () => {
        w.close()
        resolve({ ok: true, detail: "event received" })
      })
      w.on("error", (e) => resolve({ ok: false, detail: e.code || e.message }))
    } catch (e) {
      return resolve({ ok: false, detail: e.code || e.message })
    }
    process.stderr.write("WATCHING\n")
    setTimeout(() => {
      w.close()
      resolve({ ok: false, detail: "no event in 8s" })
    }, 8000)
  })
}

process.stdout.write(JSON.stringify(results))
