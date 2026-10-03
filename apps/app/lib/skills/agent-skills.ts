import "server-only"

import { readdir, readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

import { harnessOwnSkills, type HarnessOwnSkills } from "@/lib/agent/harnesses"

import { parseFrontmatter, type SkillMetadata } from "./frontmatter"

/**
 * Harness Skills (#1560): the Skills a desktop chat's coding agent loads
 * itself from its folders in the user's home (`~/.claude/skills` for Claude
 * Code, `~/.agents/skills` for Codex). The agent keeps loading them its own
 * way; Screenplay only lists them in the merged index and the `/` menu,
 * ranked below the canvas's and above App Skills, and reads one for
 * `read_skill`. It never writes these folders.
 *
 * Each is a `<dir>/<folder>/SKILL.md`. These are the user's own files, so a
 * Skill Screenplay can't parse is left out rather than failing the chat, and
 * the first folder of a name wins.
 */
export interface AgentSkills {
  /** The agent's name, which the `/` menu shows as the source. */
  agentName: string
  index(): Promise<SkillMetadata[]>
  /** A Skill's SKILL.md by name; `null` when the agent has none. */
  read(name: string): Promise<string | null>
}

/** The Harness Skills of `harnessKey`'s agent, or `null` when it has none. */
export function agentSkillsFor(
  harnessKey: string | null | undefined,
  home: string = homedir()
): AgentSkills | null {
  const own = harnessOwnSkills(harnessKey)
  return own ? agentSkillsAt(home, own) : null
}

/** {@link AgentSkills} over `own`'s folders under `home`. */
export function agentSkillsAt(
  home: string,
  own: HarnessOwnSkills
): AgentSkills {
  const scan = async () => {
    const found = new Map<string, { metadata: SkillMetadata; raw: string }>()
    for (const root of await expandDirs(home, own.dirs)) {
      const entries = await readdir(root).catch(() => [] as string[])
      for (const entry of entries.sort()) {
        const path = join(root, entry, "SKILL.md")
        const raw = await readFile(path, "utf-8").catch(() => null)
        if (raw === null) continue
        let metadata: SkillMetadata
        try {
          metadata = withBlockDescription(
            parseFrontmatter(raw, path).metadata,
            raw
          )
        } catch {
          continue
        }
        if (!found.has(metadata.name))
          found.set(metadata.name, { metadata, raw })
      }
    }
    return found
  }
  return {
    agentName: own.agentName,
    async index() {
      return Array.from((await scan()).values(), (s) => s.metadata).sort(
        (a, b) => a.name.localeCompare(b.name)
      )
    },
    async read(name) {
      return (await scan()).get(name)?.raw ?? null
    },
  }
}

/**
 * Each of `dirs` under `home`, a trailing `/*` standing for every folder
 * inside it (Claude Code's `synced/<id>/` folders of claude.ai skills).
 */
async function expandDirs(
  home: string,
  dirs: readonly string[]
): Promise<string[]> {
  const roots: string[] = []
  for (const dir of dirs) {
    if (!dir.endsWith("/*")) {
      roots.push(join(home, dir))
      continue
    }
    const parent = join(home, dir.slice(0, -2))
    const children = await readdir(parent).catch(() => [] as string[])
    roots.push(...children.sort().map((child) => join(parent, child)))
  }
  return roots
}

/**
 * A description written as a YAML block (`description: >`, then indented
 * lines), which the shared parser reads as just `>`, joined onto one line.
 */
function withBlockDescription(
  metadata: SkillMetadata,
  raw: string
): SkillMetadata {
  if (!/^[>|][+-]?$/.test(metadata.description)) return metadata
  const lines = raw.split("\n")
  const start = lines.findIndex((l) => /^description\s*:/.test(l))
  const block: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(line)) break
    block.push(line.trim())
  }
  return { ...metadata, description: block.join(" ") || metadata.description }
}

/** {@link AgentSkills.index}, or none when it can't be read. */
export async function loadAgentSkills(
  agent: AgentSkills | null
): Promise<SkillMetadata[]> {
  return agent ? agent.index().catch(() => []) : []
}
