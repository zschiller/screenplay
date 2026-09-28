/**
 * A tiny `--flag value` / `--flag=value` / `--bool` parser for the harness's
 * four entry points.
 *
 * Hand-rolled rather than a dependency: the whole surface is a handful of flags,
 * and Node's own `util.parseArgs` would still need every option declared up front
 * — which is more ceremony than four scripts warrant.
 */
export interface ParsedArgs {
  flags: Record<string, string | true>
  positionals: string[]
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: Record<string, string | true> = {}
  const positionals: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith("--")) {
      positionals.push(arg)
      continue
    }
    const body = arg.slice(2)
    const eq = body.indexOf("=")
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1)
      continue
    }
    const next = argv[i + 1]
    if (next && !next.startsWith("--")) {
      flags[body] = next
      i++
    } else {
      flags[body] = true
    }
  }

  return { flags, positionals }
}

/** A flag's string value, or `undefined` when absent or given as a bare boolean. */
export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name]
  return typeof value === "string" ? value : undefined
}

/** Whether a boolean flag was passed (`--fresh`, or `--fresh=false` to negate). */
export function boolFlag(args: ParsedArgs, name: string): boolean {
  const value = args.flags[name]
  if (value === undefined) return false
  return value !== "false" && value !== "0"
}

/** A repeated or comma-separated list flag: `--screens a,b --screens c`. */
export function listFlag(args: ParsedArgs, name: string): string[] {
  const value = args.flags[name]
  if (typeof value !== "string") return []
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * `--hosted`, which every entry point takes: capture the hosted build rather
 * than the local one (see `isHostedCapture`). Applied to the environment
 * before the profile resolves, since that is what reads it, and so the server
 * the harness spawns inherits it. Put it after any positional argument: a bare
 * flag followed by a word takes that word as its value.
 */
export function applyHostedFlag(args: ParsedArgs): void {
  if (boolFlag(args, "hosted")) process.env.SCREENSHOTS_HOSTED = "1"
}
