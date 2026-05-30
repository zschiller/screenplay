/**
 * Pure edit-application logic shared by the `edit_file` tool. Kept free of any
 * sandbox / `server-only` import so the correctness rules — unique match unless
 * `replaceAll` — are unit-tested without a VM.
 *
 * The result is a discriminated union: success carries the rewritten content
 * and how many occurrences were replaced; failure carries a machine-readable
 * reason (`not_found`, or `ambiguous` with the match count) so the tool adapter
 * can render a precise, actionable message instead of silently editing the
 * wrong occurrence.
 */
export type EditResult =
  | { ok: true; content: string; replacements: number }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "ambiguous"; count: number }

export function applyTextEdit(opts: {
  content: string
  oldString: string
  newString: string
  replaceAll?: boolean
}): EditResult {
  const { content, oldString, newString, replaceAll = false } = opts

  const count = countOccurrences(content, oldString)
  if (count === 0) return { ok: false, reason: "not_found" }

  if (replaceAll) {
    return {
      ok: true,
      content: content.split(oldString).join(newString),
      replacements: count,
    }
  }

  if (count > 1) return { ok: false, reason: "ambiguous", count }

  return { ok: true, content: content.replace(oldString, newString), replacements: 1 }
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0
  let count = 0
  let from = 0
  for (;;) {
    const i = haystack.indexOf(needle, from)
    if (i === -1) break
    count++
    from = i + needle.length
  }
  return count
}
