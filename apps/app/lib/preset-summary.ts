import { parseCopyPatterns, parseEnvVars } from "@/lib/env-utils"
import type { RepoConfig } from "@/lib/repo-configs.types"

/**
 * What a preset sets, as the short facts its settings row shows (#784): the
 * setup and run scripts, then the port and env var count on the web build, or
 * the files it copies on desktop, where the port is a logical key portless
 * remaps and env vars give way to files copied from the checkout.
 */
export function presetSummary(
  config: RepoConfig,
  localBuild: boolean
): { commands: string[]; facts: string[] } {
  const commands = [config.setupScript, config.devScript]
    .map((s) => s.trim())
    .filter(Boolean)
  const facts: string[] = []
  if (localBuild) {
    const patterns = parseCopyPatterns(config.copyPatterns)
    if (patterns.length) facts.push(`copies ${patterns.join(", ")}`)
  } else {
    facts.push(`port ${config.devServerPort}`)
    const envCount = Object.keys(parseEnvVars(config.envVars)).length
    if (envCount) {
      facts.push(`${envCount} env ${envCount === 1 ? "var" : "vars"}`)
    }
  }
  return { commands, facts }
}

/**
 * The name a duplicate of `config` gets: "<name> copy", then "<name> copy 2"
 * and on, skipping any name its project already uses. A preset's name is only
 * unique within its project, so the duplicate never trips the form's
 * collision check.
 */
export function duplicateName(
  config: RepoConfig,
  existing: RepoConfig[]
): string {
  const taken = new Set(
    existing
      .filter((c) => c.repoFullName === config.repoFullName)
      .map((c) => c.name)
  )
  const base = `${config.name || "default"} copy`
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const next = `${base} ${n}`
    if (!taken.has(next)) return next
  }
}
