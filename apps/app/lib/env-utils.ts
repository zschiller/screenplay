/**
 * Parse a multi-line KEY=VALUE env var string into a Record.
 * Supports comments (#), quoted values, and blank lines.
 */
export function parseEnvVars(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (key) env[key] = value
  }
  return env
}

/**
 * Parse a multi-line glob-pattern list (the Repo's "copy into workspace"
 * setting) into the pattern array the sandbox source carries. One pattern per
 * line; blank lines and `#` comments are dropped.
 */
export function parseCopyPatterns(text: string | undefined): string[] {
  if (!text) return []
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
}
