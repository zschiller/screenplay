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
 * Parse a SKILL.md's raw text into `{ metadata, body }`. Throws when the
 * frontmatter block is missing or doesn't declare both `name` and
 * `description` — a malformed Skill is a hard error, not a silent skip, so it
 * surfaces at load time rather than as a confusing absence later. `origin` is
 * woven into the error message to point at the offending file.
 */
export function parseFrontmatter(
  raw: string,
  origin: string
): { metadata: SkillMetadata; body: string } {
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
    fields[key] = value.trim().replace(/^"(.*)"$/, "$1")
  }
  if (!fields.name || !fields.description) {
    throw new Error(
      `Skill ${origin} frontmatter must declare both "name" and "description".`
    )
  }
  return {
    metadata: { name: fields.name, description: fields.description },
    body,
  }
}
