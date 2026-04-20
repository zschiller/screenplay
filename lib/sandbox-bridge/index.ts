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
