/**
 * Shared SKILL.md frontmatter parser.
 *
 * Both Skill sources parse the same on-disk shape — a YAML-style frontmatter
 * block declaring `name` + `description`, followed by the markdown body:
 *
 *   ---
 *   name: screenplay-add-knob
 *   description: Add interactive controls that ...
 *   ---
 *   <body>
 *
 * The App-Skill loader (`lib/skills/index.ts`, reads `lib/skills/`) and the
 * Repo-Skill enumerator (`lib/skills/repo-skills.ts`, reads a Branch's
 * `.claude/skills/` in its sandbox) both route through this one pure function
 * so the contract — required fields, quote stripping, body extraction — is
 * defined in exactly one place. No I/O here: callers hand us the raw text and
 * an `origin` string used only for error messages.
 */

export interface SkillMetadata {
  name: string
  description: string
}

/**
 * Which chat a Skill is written for. Workspace agents (the default) work in a
 * sandbox; the Coordinator (`audience: coordinator`) works the whole canvas
 * with its own tools, so neither sees the other's Skills.
 */
export type SkillAudience = "workspace" | "coordinator"

/** YAML's double-quoted escapes this parser reads; any other stays as written. */
const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  n: "\n",
  t: "\t",
}

/**
 * A scalar's value without its YAML quotes: a single-quoted one with `''`
 * read as `'`, a double-quoted one with its escapes read.
 */
function unquote(value: string): string {
  const single = value.match(/^'(.*)'$/)
  if (single) return (single[1] ?? "").replaceAll("''", "'")
  const double = value.match(/^"(.*)"$/)
  if (double) {
    return (double[1] ?? "").replace(
      /\\(.)/g,
      (escape, c: string) => ESCAPES[c] ?? escape
    )
  }
  return value
}

/**
 * Parse a SKILL.md's raw text into `{ metadata, body }`. Throws when the
 * frontmatter block is missing or doesn't declare both `name` and
 * `description` — a malformed Skill is a hard error, not a silent skip, so it
 * surfaces at load time rather than as a confusing absence later. `origin` is
 * woven into the error message to point at the offending file.
 */
export function parseFrontmatter(
  raw: string,
  origin: string
): { metadata: SkillMetadata; body: string; audience: SkillAudience } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!match) {
    throw new Error(`Skill ${origin} is missing a YAML frontmatter block.`)
  }
  const [, frontmatter = "", body = ""] = match
  const fields: Record<string, string> = {}
  for (const line of frontmatter.split("\n")) {
    const m = line.match(/^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/)
    if (!m) continue
    const [, key = "", value = ""] = m
    fields[key] = unquote(value.trim())
  }
  if (!fields.name || !fields.description) {
    throw new Error(
      `Skill ${origin} frontmatter must declare both "name" and "description".`
    )
  }
  const audience = fields.audience || "workspace"
  if (audience !== "workspace" && audience !== "coordinator") {
    throw new Error(
      `Skill ${origin} frontmatter declares audience="${audience}"; use "workspace" or "coordinator".`
    )
  }
  return {
    metadata: { name: fields.name, description: fields.description },
    body,
    audience,
  }
}
