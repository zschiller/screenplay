import "server-only"

import { probeOk } from "./process-runner"
import type { Harness, HarnessProcessRunner } from "./types"

/**
 * Google Antigravity on the desktop (Gemini models). The `agy` CLI has no ACP
 * mode, so chat runs on Google's own ACP server for it, `agy_acp_server`: a
 * separate download listed in the ACP registry (`antigravity-acp`) as one
 * self-contained executable per platform, with no installer and no updater.
 * It keeps its own login, apart from `agy`'s, under
 * `$GEMINI_HOME/antigravity-acp/`, and signs in only through ACP's
 * `authenticate`.
 */

/** The server release we install, as the ACP registry lists it. */
export const ANTIGRAVITY_ACP_VERSION = "1.3.0"

/**
 * What the install puts on `PATH`: a wrapper in `~/.local/bin` (already on
 * the sidecar's augmented `PATH`) that runs the unpacked server where it sits,
 * since the server finds the files packed beside it from its own path.
 */
export const ANTIGRAVITY_ACP_BINARY = "agy_acp_server.par"

const RELEASES = "https://dl.google.com/agy-extensions/releases"

/**
 * The install command the setup terminal runs: download this platform's
 * server into `~/.local/share/agy-acp-server/<version>`, then write the
 * wrapper. The platform is read on the host by `uname`, the way the
 * registry's archives are split. On Linux the server must be started with an
 * empty `--uid=`, or it drops to group `nobody` and aborts where there is
 * none, so the wrapper passes it there.
 */
export function buildAntigravityInstallCommand(): string {
  const dir = `"$HOME/.local/share/agy-acp-server/${ANTIGRAVITY_ACP_VERSION}"`
  const bin = `"$HOME/.local/bin"`
  const asset = (os: string, arch: string) =>
    `${os}/agy-acp-server-${ANTIGRAVITY_ACP_VERSION}-${os === "macos" ? "darwin" : "linux"}-${arch}.zip`
  return [
    `case "$(uname -s)-$(uname -m)" in`,
    `Darwin-arm64) a=${asset("macos", "arm64")}; x= ;;`,
    `Darwin-x86_64) a=${asset("macos", "x86_64")}; x= ;;`,
    `Linux-x86_64) a=${asset("linux", "x86_64")}; x=--uid= ;;`,
    `Linux-aarch64|Linux-arm64) a=${asset("linux", "arm64")}; x=--uid= ;;`,
    `*) echo "Antigravity has no ACP server for $(uname -s) $(uname -m)" >&2; exit 1 ;;`,
    `esac &&`,
    `mkdir -p ${dir} ${bin} &&`,
    `curl -fL --progress-bar -o ${dir}/server.zip "${RELEASES}/$a" &&`,
    `unzip -oq ${dir}/server.zip -d ${dir} &&`,
    `rm -f ${dir}/server.zip &&`,
    `chmod +x ${dir}/${ANTIGRAVITY_ACP_BINARY} &&`,
    `printf '#!/bin/sh\\nexec "%s" %s "$@"\\n' ${dir}/${ANTIGRAVITY_ACP_BINARY} "$x" > ${bin}/${ANTIGRAVITY_ACP_BINARY} &&`,
    `chmod +x ${bin}/${ANTIGRAVITY_ACP_BINARY}`,
  ].join(" ")
}

/**
 * The server's sign-in, for the setup terminal. It signs in only through
 * ACP's `authenticate`, so this speaks just enough ACP to ask for it: start
 * the server, `initialize`, then `authenticate` with the Google account method
 * (`oauth-personal`), else the first one it offers. Its output goes straight
 * to the terminal so its sign-in link shows there. A method of ACP's
 * `terminal` type is run as the server with that method's args instead. The
 * exit code says whether it signed in.
 */
export const ANTIGRAVITY_SIGN_IN_SCRIPT = `
const { spawn } = require("node:child_process")
const bin = ${JSON.stringify(ANTIGRAVITY_ACP_BINARY)}
const server = spawn(bin, [], { stdio: ["pipe", "pipe", "inherit"] })
const finish = (code) => { server.kill(); process.exit(code) }
server.on("error", (e) => { console.error("Couldn’t start Antigravity: " + e.message); process.exit(1) })
server.on("exit", (code) => { console.error("Antigravity stopped before signing in."); process.exit(code || 1) })
const send = (message) => server.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n")
const answer = (message) => {
  if (message.method !== undefined && message.id !== undefined) {
    send({ id: message.id, error: { code: -32601, message: "Method not found" } })
  } else if (message.id === 1) {
    if (message.error) { console.error(message.error.message); return finish(1) }
    const methods = (message.result && message.result.authMethods) || []
    const method = methods.find((m) => m.id === "oauth-personal") || methods[0]
    if (!method) { console.log("Antigravity needs no sign-in."); return finish(0) }
    if (method.type === "terminal") {
      server.removeAllListeners("exit")
      server.kill()
      const login = spawn(bin, method.args || [], { stdio: "inherit", env: { ...process.env, ...method.env } })
      login.on("exit", (code) => process.exit(code ?? 1))
      return
    }
    console.log("Signing in to Antigravity with " + (method.name || method.id) + "…")
    send({ id: 2, method: "authenticate", params: { methodId: method.id } })
  } else if (message.id === 2) {
    if (message.error) { console.error(message.error.message); return finish(1) }
    console.log("Signed in to Antigravity.")
    finish(0)
  }
}
let buffer = ""
server.stdout.on("data", (chunk) => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, end)
    buffer = buffer.slice(end + 1)
    try { answer(JSON.parse(line)) } catch {}
  }
})
send({ id: 1, method: "initialize", params: { protocolVersion: 1, clientCapabilities: {} } })
`

/**
 * Whether the server's own login is present: the auth method its sign-in
 * persisted in `$GEMINI_HOME/antigravity-acp/settings.json` (`GEMINI_HOME`
 * defaulting to `~/.gemini`, where the `agy` CLI keeps its files). The token
 * itself is cached beside it; one that has lapsed shows as an
 * "Authentication required" error on the chat's next turn.
 */
export async function probeAntigravityAuth(
  run: HarnessProcessRunner
): Promise<boolean> {
  return probeOk(
    run,
    "sh",
    ["-c", 'cat "${GEMINI_HOME:-$HOME/.gemini}/antigravity-acp/settings.json"'],
    ({ stdout }) => {
      try {
        const settings = JSON.parse(stdout) as { auth?: { type?: unknown } }
        return (
          typeof settings.auth?.type === "string" && settings.auth.type !== ""
        )
      } catch {
        return false
      }
    }
  )
}

/**
 * Google Antigravity: Gemini models, through Google's ACP server on the
 * user's own Google sign-in. Desktop only: its broker provider, `google`,
 * authenticates by query parameter, which the sandbox firewall can't
 * broker, so the hosted selection fold always skips it.
 */
export const antigravityHarness: Harness = {
  key: "antigravity",
  label: "Antigravity",
  // There is no npm package; the hosted fold never installs it (see above).
  installPackage: "",
  // A terminal runs the `agy` CLI itself.
  launchCommand: "agy",
  brokerProviderKey: "google",
  gateEnvVar: "GEMINI_API_KEY",
  launchArgv: ["agy"],
  // Chat needs the ACP server, not `agy`, so detection looks for it.
  hostBinary: ANTIGRAVITY_ACP_BINARY,
  acpAdapter: {
    command: ANTIGRAVITY_ACP_BINARY,
    args: [],
    // It advertises `model` and `mode` config options. It validates the model
    // eagerly: an id the sign-in can't run is rejected with invalid params,
    // and the session stays on its default.
    modelOption: "model",
    // It has no steering request, and a prompt sent while one runs doesn't
    // join it.
    promptQueueing: false,
    // Its modes are permission levels (`default`, `auto_edit`, `yolo`), with
    // no plan mode or plan option, so a plan turn plans from the prompt and
    // its last reply is the plan.
    plan: "reply",
    // It loads an MCP server's tools lazily and calls them through its own
    // `call_mcp_tool`, so no fixed name reaches the model.
  },
  // Its model ids carry the thinking level; there is no separate effort
  // option. These are what it offers a personal Google sign-in; one it
  // doesn't offer falls back to its default (ADR 0011).
  models: [
    { id: "gemini-pro-agent", label: "Gemini 3.1 Pro (High)" },
    { id: "gemini-3.1-pro-low", label: "Gemini 3.1 Pro (Low)" },
    { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)" },
    { id: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)" },
    { id: "gemini-3.8-flash-low", label: "Gemini 3.8 Flash (Low)" },
  ],
  defaultModelId: "gemini-pro-agent",
  // Never provisioned in a sandbox, so there is nothing to seed.
  seed: async () => {},
  probeAuth: probeAntigravityAuth,
  buildInstallCommand: buildAntigravityInstallCommand,
  // Run by the app's own Node, which is on the setup terminal's PATH.
  authCommand: ["node", "-e", ANTIGRAVITY_SIGN_IN_SCRIPT],
}
