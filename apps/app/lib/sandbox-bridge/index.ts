import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { join } from "node:path"

const dir = join(process.cwd(), "lib", "sandbox-bridge")

export const PROXY_JS: string = readFileSync(join(dir, "proxy.mjs"), "utf8")

const BRIDGE_JS_RAW = readFileSync(join(dir, "bridge.js"), "utf8")

export const BRIDGE_VERSION: string = createHash("sha256")
  .update(BRIDGE_JS_RAW)
  .digest("hex")
  .slice(0, 16)

// Versioned bridge content: a prelude exposes the hash so the script can
// report its version to the parent, enabling stale-bridge detection.
export const BRIDGE_JS: string =
  `window.__screenplayBridgeVersion=${JSON.stringify(BRIDGE_VERSION)};\n` +
  BRIDGE_JS_RAW

const MOCKUP_KNOBS_JS = readFileSync(join(dir, "mockup-knobs.js"), "utf8")
const MOCKUP_STATE_JS = readFileSync(join(dir, "mockup-state.js"), "utf8")

// What every Mockup page (#1309) runs ahead of its own scripts: the same DOM
// bridge a frame's proxy injects, so a chat can target an element in it, and
// the knobs and shared-state runtimes a static page uses in place of
// `@screenplay.space/knobs` and `@screenplay.space/state`.
export const MOCKUP_RUNTIME_JS: string = [
  BRIDGE_JS,
  MOCKUP_KNOBS_JS,
  MOCKUP_STATE_JS,
].join("\n")

// The Frame Stream service every hosted Workspace runs for its shared frames
// (#1392), written into the Sandbox and run with Node's built-ins only.
export const FRAME_STREAM_JS: string = readFileSync(
  join(dir, "frame-stream.mjs"),
  "utf8"
)
