/**
 * @mentions in comment bodies. A mention is stored as plain text, `@` plus a
 * room member's display name, so bodies stay readable anywhere they're shown
 * (the player feed, an agent prompt). These pure helpers drive the composer's
 * member picker and the highlighting of names in a rendered comment.
 */

/** The `@` query the caret sits in, if any: the text typed after an `@` that
 *  starts the body or follows whitespace, up to the caret, with no newline. */
export function activeMentionQuery(
  text: string,
  caret: number
): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const at = before.lastIndexOf("@")
  if (at < 0) return null
  if (at > 0 && !/\s/.test(before[at - 1]!)) return null
  const query = before.slice(at + 1)
  if (/[\n@]/.test(query) || query.length > 40) return null
  // A query that is already two words past a space isn't a mention anymore.
  if (/\s\S*\s/.test(query)) return null
  return { start: at, query }
}

/** Members whose name matches `query` (prefix of the name or any word). */
export function matchMembers<T extends { name: string }>(
  members: readonly T[],
  query: string,
  limit = 5
): T[] {
  const q = query.trim().toLowerCase()
  const hits = members.filter((m) => {
    const name = m.name.toLowerCase()
    return (
      !q || name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q))
    )
  })
  return hits.slice(0, limit)
}

/** Replace the `@query` at `start..caret` with `@Name ` and return the new
 *  text and the caret after it. */
export function insertMention(
  text: string,
  start: number,
  caret: number,
  name: string
): { text: string; caret: number } {
  const insert = `@${name} `
  return {
    text: text.slice(0, start) + insert + text.slice(caret),
    caret: start + insert.length,
  }
}

export type BodySegment = { text: string; mention: boolean }

/** Split a body into plain runs and `@Name` runs for the given member names.
 *  Longest names match first, so "@Ann Lee" wins over "@Ann". */
export function splitMentions(
  body: string,
  names: readonly string[]
): BodySegment[] {
  const sorted = [...new Set(names)]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  if (sorted.length === 0) return [{ text: body, mention: false }]
  const escaped = sorted.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  const re = new RegExp(`(^|\\s)@(${escaped.join("|")})(?![\\w])`, "g")
  const out: BodySegment[] = []
  let last = 0
  for (const m of body.matchAll(re)) {
    const at = m.index! + m[1]!.length
    if (at > last) out.push({ text: body.slice(last, at), mention: false })
    out.push({ text: `@${m[2]}`, mention: true })
    last = at + 1 + m[2]!.length
  }
  if (last < body.length) out.push({ text: body.slice(last), mention: false })
  return out
}
