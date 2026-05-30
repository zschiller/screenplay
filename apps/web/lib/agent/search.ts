/**
 * Pure invocation builders for the `grep` and `glob` tools. These return the
 * `{ cmd, args }` a sandbox should run; the actual `sandbox.runCommand` stays
 * I/O inside each tool's `execute`. Keeping the argument construction and
 * fallback strategy here — free of any `server-only` import — lets the rules be
 * unit-tested without a VM.
 */

export interface Invocation {
  cmd: string
  args: string[]
}

export interface GrepOptions {
  pattern: string
  path?: string
  /** File-glob to restrict the search, e.g. `*.ts`. */
  include?: string
  ignoreCase?: boolean
  /** Whether ripgrep is available; when false, a `grep -rn` fallback is built. */
  useRipgrep: boolean
}

/**
 * Build the search invocation. Prefers ripgrep (`rg`), which is fast and skips
 * `.gitignore`d paths; falls back to a portable `grep -rn` when ripgrep isn't
 * installed in the sandbox image. Both exclude `node_modules` and `.git` so
 * results stay relevant (matching `list_files`).
 */
export function buildGrepInvocation(opts: GrepOptions): Invocation {
  const { pattern, path, include, ignoreCase = false } = opts

  if (opts.useRipgrep) {
    const args = ["-n", "--no-heading", "--color=never"]
    if (ignoreCase) args.push("-i")
    if (include) args.push("-g", include)
    args.push("-g", "!node_modules", "-g", "!.git")
    args.push(pattern, path ?? ".")
    return { cmd: "rg", args }
  }

  const args = ["-rn"]
  if (ignoreCase) args.push("-i")
  if (include) args.push(`--include=${include}`)
  args.push("--exclude-dir=node_modules", "--exclude-dir=.git")
  args.push(pattern, path ?? ".")
  return { cmd: "grep", args }
}

export interface GlobOptions {
  /** A file-matching pattern, e.g. `**\/*.tsx`. */
  pattern: string
  path?: string
}

/**
 * Build a `find` invocation matching files by pattern. `find -path` globs span
 * `/`, so a recursive `**` collapses to a single `*`; the result anchors the
 * pattern anywhere in the tree. Excludes `node_modules` and `.git` and matches
 * regular files only.
 */
export function buildGlobInvocation(opts: GlobOptions): Invocation {
  const pathPattern = `*/${opts.pattern.replace(/^\*\*\//, "")}`.replace(/\*\*/g, "*")
  return {
    cmd: "find",
    args: [
      opts.path ?? ".",
      "!",
      "-path",
      "*/node_modules/*",
      "!",
      "-path",
      "*/.git/*",
      "-type",
      "f",
      "-path",
      pathPattern,
    ],
  }
}

/** Default cap on tool output kept in session history (chars). */
export const MAX_OUTPUT_LENGTH = 20_000

/**
 * Truncate over-long tool output to `max` characters, appending a notice with
 * how many characters were dropped so the model knows the result was clipped.
 */
export function truncateOutput(text: string, max: number = MAX_OUTPUT_LENGTH): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n...(truncated ${text.length - max} chars)`
}
