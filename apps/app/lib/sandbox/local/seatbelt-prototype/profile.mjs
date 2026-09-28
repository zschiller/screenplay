// PROTOTYPE (issue #992), throwaway. Not imported by the app.
//
// Generates the Seatbelt profile a Branch's dev server and setup script would
// run under on desktop. It follows the shape of @anthropic-ai/sandbox-runtime's
// generated profile (deny default, Chrome-renderer-style allowances), with the
// three changes the research (docs/research/dev-server-isolation-macos.md)
// said srt can't express today:
//
//   1. Loopback is limited to the dev port. srt's `allowLocalBinding` allows
//      outbound to `localhost:*`, which reaches the terminal socket and Yjs.
//   2. No `com.apple.SecurityServer` / `com.apple.securityd.xpc`, so the
//      keychain (and the `gh` token in it) is out of reach. srt always allows
//      both.
//   3. `com.apple.FSEvents` is opt-in, so we can see whether HMR needs it.
//
// Modes:
//   dev      bind/inbound on the dev port only, no egress
//   install  no bind, egress to any host on :443/:80 plus DNS (stands in for
//            srt's domain-allowlisting proxy, which Screenplay would put in
//            front of this in the real thing)

import { realpathSync } from "node:fs"
import { dirname } from "node:path"

export const LOG_TAG = "screenplay-992"

const q = (p) => JSON.stringify(p)

function real(p) {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/**
 * @param {object} o
 * @param {"dev"|"install"} o.mode
 * @param {string} o.home          the user's home (denied for reads)
 * @param {string} o.worktree      read+write
 * @param {string} o.stateDir      read+write: per-sandbox TMPDIR and caches
 * @param {string[]} o.readOnly    extra read-only paths inside $HOME (toolchain)
 * @param {number} [o.devPort]     dev mode only
 * @param {boolean} [o.fsevents]   allow com.apple.FSEvents
 * @param {boolean} [o.keychain]   allow SecurityServer (srt's default), for comparison
 * @param {boolean} [o.anyLoopback] allow outbound to localhost:* (srt's allowLocalBinding), for comparison
 */
export function makeProfile(o) {
  const home = real(o.home)
  const worktree = real(o.worktree)
  const stateDir = real(o.stateDir)
  const readOnly = [...new Set(o.readOnly.map(real))]

  const mach = [
    "com.apple.audio.systemsoundserver",
    "com.apple.distributed_notifications@Uv3",
    "com.apple.FontObjectsServer",
    "com.apple.fonts",
    "com.apple.logd",
    "com.apple.lsd.mapdb",
    "com.apple.PowerManagement.control",
    "com.apple.system.logger",
    "com.apple.system.notification_center",
    "com.apple.system.opendirectoryd.libinfo",
    "com.apple.system.opendirectoryd.membership",
    "com.apple.bsd.dirhelper",
    "com.apple.coreservices.launchservicesd",
  ]
  if (o.keychain) mach.push("com.apple.securityd.xpc", "com.apple.SecurityServer")
  if (o.fsevents) mach.push("com.apple.FSEvents")
  if (o.mode === "install") mach.push("com.apple.dnssd.service")

  const lines = [
    "(version 1)",
    `(deny default (with message ${q(LOG_TAG)}))`,
    "",
    "(allow process-exec)",
    "(allow process-fork)",
    "(allow process-info* (target same-sandbox))",
    "(allow signal (target same-sandbox))",
    "(allow mach-priv-task-port (target same-sandbox))",
    "(allow user-preference-read)",
    "(allow ipc-posix-shm)",
    "(allow ipc-posix-sem)",
    "(allow sysctl-read)",
    "(allow sysctl-write (sysctl-name \"kern.tcsm_enable\"))",
    "(allow iokit-get-properties)",
    '(allow iokit-open (iokit-registry-entry-class "IOSurfaceRootUserClient") (iokit-registry-entry-class "RootDomainUserClient"))',
    "(allow system-socket (require-all (socket-domain AF_SYSTEM) (socket-protocol 2)))",
    "(allow distributed-notification-post)",
    "",
    "; Mach services (no SecurityServer unless comparing with srt)",
    "(allow mach-lookup",
    ...mach.map((m) => `  (global-name ${q(m)})`),
    ")",
    "",
    "; Devices",
    '(allow file-ioctl (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom") (literal "/dev/dtracehelper") (literal "/dev/tty"))',
    '(allow file-read* file-write-data (literal "/dev/null") (literal "/dev/zero") (literal "/dev/random") (literal "/dev/urandom") (literal "/dev/tty") (literal "/dev/dtracehelper"))',
    "",
    "; Network",
  ]

  // Unix sockets only under the sandbox's own state dir (its TMPDIR). This
  // keeps ssh-agent ($SSH_AUTH_SOCK) and docker.sock out.
  lines.push(
    "(allow system-socket (socket-domain AF_UNIX))",
    `(allow network-bind (local unix-socket (subpath ${q(stateDir)})))`,
    `(allow network-outbound (remote unix-socket (subpath ${q(stateDir)})))`,
    // IPv4/IPv6 sockets need system-socket too.
    "(allow system-socket (socket-domain AF_INET))",
    "(allow system-socket (socket-domain AF_INET6))"
  )

  if (o.mode === "dev") {
    const p = o.devPort
    // "*:<port>" on bind/inbound admits dual-stack sockets (::ffff:127.0.0.1),
    // which "localhost:<port>" doesn't match (see srt's comment on this).
    lines.push(
      `(allow network-bind (local ip "*:${p}"))`,
      `(allow network-inbound (local ip "*:${p}"))`,
      // The dev server talking to itself (Next does this for RSC/revalidation).
      `(allow network-outbound (remote ip "localhost:${p}"))`
    )
    if (o.anyLoopback) {
      lines.push(
        '(allow network-bind (local ip "*:*"))',
        '(allow network-inbound (local ip "*:*"))',
        '(allow network-outbound (remote ip "localhost:*"))'
      )
    }
  } else {
    lines.push(
      '(allow network-outbound (remote ip "*:443"))',
      '(allow network-outbound (remote ip "*:80"))',
      '(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))'
    )
  }

  // Reads: everything, then deny $HOME, then re-allow the worktree, state dir
  // and toolchain. Last match wins in SBPL.
  const allowRead = [worktree, stateDir, ...readOnly]
  lines.push(
    "",
    "; File read",
    "(allow file-read*)",
    `(deny file-read* (subpath ${q(home)}) (with message ${q(LOG_TAG)}))`,
    "(allow file-read*",
    ...allowRead.map((p) => `  (subpath ${q(p)})`),
    ")",
    // realpath() lstat()s every ancestor; allow metadata on directories only.
    "(allow file-read-metadata (vnode-type DIRECTORY))",
    // Parents of allowed paths need to be stat-able (not listable) too.
    ...ancestors(allowRead, home).map((d) => `(allow file-read-metadata (literal ${q(d)}))`)
  )

  // Writes: only the worktree and the state dir.
  lines.push(
    "",
    "; File write",
    "(allow file-write*",
    `  (subpath ${q(worktree)})`,
    `  (subpath ${q(stateDir)})`,
    ")"
  )

  return lines.join("\n") + "\n"
}

function ancestors(paths, stopAt) {
  const out = new Set()
  for (const p of paths) {
    let d = dirname(p)
    while (d !== "/" && d.length >= 1) {
      out.add(d)
      if (d === stopAt) break
      d = dirname(d)
    }
  }
  return [...out]
}
