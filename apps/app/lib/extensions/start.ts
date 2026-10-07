import "server-only"

import { applyConfiguredInterfaces } from "./apply"
import { ConfigError, getConfig } from "./config"
import { extensionIds } from "./registry"

/**
 * Server start: read and check the config file once, and refuse to start with
 * a message naming each bad field rather than run half-configured. Then build
 * what it picks for each interface; one that can't be built (a bad Coding CLI
 * key, say) refuses start too.
 */
export async function checkConfigAtStart(): Promise<void> {
  try {
    const config = getConfig()
    const ids = extensionIds()
    if (ids.length > 0) console.log(`[extensions] ${ids.join(", ")}`)
    if (config.file) console.log(`[config] ${config.file}`)
    await applyConfiguredInterfaces(config)
  } catch (err) {
    const message =
      err instanceof ConfigError
        ? err.message
        : `${getConfigLabel()} can’t be used, so Screenplay won’t start:\n  ${
            err instanceof Error ? err.message : String(err)
          }`
    console.error(message)
    process.exit(1)
  }
}

function getConfigLabel(): string {
  return process.env.SCREENPLAY_CONFIG || "The config"
}
