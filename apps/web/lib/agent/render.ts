/**
 * Pure file-window rendering shared by the `read_file` tool. Kept free of any
 * sandbox / `server-only` import so the line-numbering and windowing rules are
 * unit-tested without a VM.
 *
 * Output mirrors `cat -n`: each line is prefixed with its 1-based number,
 * right-aligned in a 6-column gutter, followed by a tab and the line text.
 * `read_file` consumers must strip this gutter before reusing a line as an
 * `edit_file` `old_string` — the tool descriptions say so explicitly.
 */

/** Default line cap, mirroring Claude Code's read tool. */
export const DEFAULT_LINE_LIMIT = 2000

const GUTTER_WIDTH = 6

export function renderFileWindow(opts: {
  content: string
  offset?: number
  limit?: number
}): string {
  const { content } = opts
  if (content === "") return "(empty file)"

  const lines = splitLines(content)
  const total = lines.length

  const offset = Math.max(1, Math.floor(opts.offset ?? 1))
  const limit = Math.max(1, Math.floor(opts.limit ?? DEFAULT_LINE_LIMIT))
  const startIdx = offset - 1
  const endIdx = Math.min(total, startIdx + limit)

  const body = lines
    .slice(startIdx, endIdx)
    .map((line, i) => `${String(startIdx + i + 1).padStart(GUTTER_WIDTH)}\t${line}`)
    .join("\n")

  const windowed = startIdx > 0 || endIdx < total
  if (!windowed) return body

  return `${body}\n\n(File has ${total} lines. Showing lines ${startIdx + 1}-${endIdx}. Use the offset/limit parameters to read more.)`
}

/**
 * Split into logical lines. A single trailing newline marks the end of the
 * last line rather than introducing an extra empty line (matching `cat -n`),
 * so "a\n" is one line, not two.
 */
function splitLines(content: string): string[] {
  const lines = content.split("\n")
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop()
  return lines
}
