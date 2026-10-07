/**
 * Option readers shared by the built-ins. Each throws a message naming the
 * implementation and option, so a bad config refuses start with something the
 * host can fix.
 */

export function optionString(
  id: string,
  options: Record<string, unknown>,
  key: string
): string | undefined {
  const value = options[key]
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `GitHub access "${id}": "${key}" must be a non-empty string`
    )
  }
  return value.trim()
}

/** A URL base with no trailing slash. */
export function optionUrl(
  id: string,
  options: Record<string, unknown>,
  key: string
): string | undefined {
  const value = optionString(id, options, key)
  if (value === undefined) return undefined
  try {
    new URL(value)
  } catch {
    throw new Error(`GitHub access "${id}": "${key}" must be a URL`)
  }
  return value.replace(/\/+$/, "")
}

/** An argv: a single command name, or a list of words. */
export function optionArgv(
  id: string,
  options: Record<string, unknown>,
  key: string
): string[] | undefined {
  const value = options[key]
  if (value === undefined) return undefined
  if (typeof value === "string" && value.trim() !== "") return [value.trim()]
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((w) => typeof w === "string" && w !== "")
  ) {
    return value as string[]
  }
  throw new Error(
    `GitHub access "${id}": "${key}" must be a command name or a list of words`
  )
}

/** Refuse options this implementation doesn't know, so a typo isn't ignored. */
export function rejectUnknownOptions(
  id: string,
  options: Record<string, unknown>,
  known: readonly string[]
): void {
  const unknown = Object.keys(options).filter((k) => !known.includes(k))
  if (unknown.length > 0) {
    throw new Error(
      `GitHub access "${id}": unknown option ${unknown
        .map((k) => `"${k}"`)
        .join(", ")} (known: ${known.join(", ")})`
    )
  }
}
