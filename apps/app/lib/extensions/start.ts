import "server-only"

import { ConfigError, getConfig } from "./config"
import { extensionIds } from "./registry"

/**
 * Server start: read and check the config file once, and refuse to start with
 * a message naming each bad field rather than run half-configured.
 */
export function checkConfigAtStart(): void {
  try {
    const config = getConfig()
    const ids = extensionIds()
    if (ids.length > 0) console.log(`[extensions] ${ids.join(", ")}`)
    if (config.file) console.log(`[config] ${config.file}`)
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err
    console.error(err.message)
    process.exit(1)
  }
}
