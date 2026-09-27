/**
 * A line-level diff of a tool call's edit (ACP `diff` content: `oldText` →
 * `newText`), for the chat's edit view. Lines both sides share render as
 * context; the rest as removed/added, in file order. Long unchanged runs fold
 * to a `skip` row so an edit to a big file shows the change, not the file.
 */
export type DiffRow =
  | { kind: "context" | "added" | "removed"; text: string }
  | { kind: "skip"; count: number }

/** Unchanged lines kept on each side of a change before the rest fold away. */
const CONTEXT_LINES = 3

/**
 * Beyond this many line pairs the LCS table is too costly to build in a render;
 * the diff falls back to "everything removed, everything added", which is
 * correct, just not minimal.
 */
const MAX_CELLS = 1_000_000

function splitLines(text: string): string[] {
  if (text === "") return []
  const lines = text.split("\n")
  // A trailing newline ends the last line; it doesn't start an empty one.
  if (lines[lines.length - 1] === "") lines.pop()
  return lines
}

/** Every line of `oldText` → `newText`, before any folding. */
export function diffLines(
  oldText: string | null | undefined,
  newText: string
): DiffRow[] {
  const a = splitLines(oldText ?? "")
  const b = splitLines(newText)

  // Trim the shared head and tail first: most edits touch a few lines of a
  // longer file, and this keeps the table to the part that changed.
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++
  }
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)

  const rows: DiffRow[] = a
    .slice(0, head)
    .map((text) => ({ kind: "context" as const, text }))
  rows.push(...diffMiddle(midA, midB))
  rows.push(
    ...a
      .slice(a.length - tail)
      .map((text) => ({ kind: "context" as const, text }))
  )
  return rows
}

function diffMiddle(a: string[], b: string[]): DiffRow[] {
  const removed = a.map((text) => ({ kind: "removed" as const, text }))
  const added = b.map((text) => ({ kind: "added" as const, text }))
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_CELLS) {
    return [...removed, ...added]
  }

  // lcs[i][j]: the longest common subsequence of a[i..] and b[j..].
  const lcs = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0)
  )
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j]
          ? lcs[i + 1]![j + 1]! + 1
          : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }

  const rows: DiffRow[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      rows.push({ kind: "context", text: a[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      rows.push({ kind: "removed", text: a[i++]! })
    } else {
      rows.push({ kind: "added", text: b[j++]! })
    }
  }
  while (i < a.length) rows.push({ kind: "removed", text: a[i++]! })
  while (j < b.length) rows.push({ kind: "added", text: b[j++]! })
  return rows
}

/**
 * Fold every run of unchanged lines longer than the context either side of a
 * change needs into one `skip` row.
 */
export function foldContext(
  rows: DiffRow[],
  context: number = CONTEXT_LINES
): DiffRow[] {
  const changed = rows.map((r) => r.kind === "added" || r.kind === "removed")
  // An edit with no changed lines has nothing to anchor context to: show it.
  if (!changed.includes(true)) return rows
  const keep = rows.map((_, i) => {
    for (
      let k = Math.max(0, i - context);
      k <= Math.min(rows.length - 1, i + context);
      k++
    ) {
      if (changed[k]) return true
    }
    return false
  })

  const out: DiffRow[] = []
  let hidden: DiffRow[] = []
  // Folding a single line saves nothing: it would trade one line for another.
  const flush = () => {
    if (hidden.length === 1) out.push(hidden[0]!)
    else if (hidden.length > 1) out.push({ kind: "skip", count: hidden.length })
    hidden = []
  }
  rows.forEach((row, i) => {
    if (keep[i]) {
      flush()
      out.push(row)
    } else {
      hidden.push(row)
    }
  })
  flush()
  return out
}
