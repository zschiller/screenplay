import { readFileSync } from "node:fs"
import { join } from "node:path"

const dir = join(process.cwd(), "lib", "sandbox-bridge")

export const PROXY_JS: string = readFileSync(join(dir, "proxy.mjs"), "utf8")
export const BRIDGE_JS: string = readFileSync(join(dir, "bridge.js"), "utf8")
