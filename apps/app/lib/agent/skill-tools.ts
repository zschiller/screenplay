import "server-only"

import { jsonSchema, tool, type JSONSchema7 } from "ai"

import { annotateTools } from "@/lib/mcp/tool-server"
import type { SkillMetadata } from "@/lib/skills/frontmatter"
import {
  formatMergedListing,
  mergeSkillIndexes,
  resolveSkillBody,
} from "@/lib/skills/merged"
import {
  enumerateRepoSkills,
  readRepoSkillBody,
  type RepoSkillFs,
} from "@/lib/skills/repo-skills"
import {
  prepareSkill,
  type SavedSkills,
  type SkillFile,
} from "@/lib/skills/saved"
import { loadAgentSkills, type AgentSkills } from "@/lib/skills/agent-skills"

/**
 * A chat's Skill tools (#1555): `read_skill` loads a Skill from the chat's
 * merged index, and `save_skill` and `delete_skill` keep the saved Skills.
 * Every chat kind gets all three, from its own App Skills and, on a Workspace
 * chat, its Branch's Repo Skills. On a desktop harness, `read_skill` also
 * reads the agent's own Skills (#1560). Each write takes a `scope`: `canvas`
 * (the canvas's, shared with its members) or `account` (the turn sender's
 * own, on every canvas, #1558), which a turn nobody sent refuses.
 */
export interface SkillToolContext {
  /** The canvas's saved Skills. */
  canvas: SavedSkills
  /**
   * The Account Skills of the person who sent the turn, or `null` on a turn
   * nobody sent (a Coordinator wake and the turns it delegates), which
   * refuses the `account` scope. Absent is the same as `null`.
   */
  account?: SavedSkills | null
  /** The chat the tools act for: what its saves record as their author. */
  chatId: string
  /** The App Skills this kind of chat sees. */
  app: {
    index(): SkillMetadata[]
    read(name: string): string | null
  }
  /**
   * The Branch's Repo Skills, on a Workspace chat; `null` when its sandbox
   * can't be reached. The Coordinator and chats with no repository have none.
   */
  repo?: () => Promise<RepoSkillFs | null>
  /** The coding agent's own Skills, on a desktop harness (#1560). */
  agent?: AgentSkills | null
}

const scopeProperty: JSONSchema7 = {
  type: "string",
  enum: ["canvas", "account"],
  description:
    "Where the skill lives: `canvas` (shared with this canvas’s members, used by every chat on it), the default, or `account` (the own skills of the person who sent this message, used by every chat they message on any canvas, which nobody else’s chats see).",
}

type Scope = { scope?: "canvas" | "account" }

/** What a write says when a turn nobody sent asks for account skills. */
const NO_ACCOUNT =
  "Error: nobody sent this turn, so it has no account skills. Use the `canvas` scope instead."

/** A saved Skill as `read_skill` returns it: SKILL.md, then each file. */
export function renderSavedSkill(content: string, files: SkillFile[]): string {
  return [
    content,
    ...files.map(
      (f) => `\n\n---\n\nThis skill’s file \`${f.path}\`:\n\n${f.content}`
    ),
  ].join("")
}

export function buildSkillTools(ctx: SkillToolContext) {
  /** The scope's Skills, or `null` for account Skills on a turn nobody sent. */
  const skills = (scope: Scope["scope"]): SavedSkills | null =>
    scope === "account" ? (ctx.account ?? null) : ctx.canvas
  // A store that can't be read has none of the name, so the lookup goes on.
  const savedReader =
    (scope: SavedSkills) =>
    async (n: string): Promise<string | null> => {
      const read = await scope.read(n).catch(() => null)
      return read?.ok
        ? renderSavedSkill(read.value.content, read.value.files)
        : null
    }
  const appListing = formatMergedListing(
    mergeSkillIndexes({ app: ctx.app.index() })
  )

  const tools = {
    read_skill: tool({
      // The App Skills ride in the description too, so a harness that gets
      // the tools before any prompt still finds them.
      description: `Load the full instructions for a skill: one listed in your instructions, or one a chat saved to this canvas or to the account of the person messaging you. Call it before acting when a request matches a skill’s description, and follow what it says. Screenplay’s own skills:\n${appListing}`,
      inputSchema: jsonSchema<{ name: string }>({
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      }),
      execute: async ({ name }) => {
        const fs = ctx.repo ? await ctx.repo() : null
        const content = await resolveSkillBody(name, {
          ...(fs ? { repo: (n: string) => readRepoSkillBody(fs, n) } : {}),
          canvas: savedReader(ctx.canvas),
          ...(ctx.account ? { account: savedReader(ctx.account) } : {}),
          ...(ctx.agent ? { agent: ctx.agent.read } : {}),
          app: (n) => ctx.app.read(n),
        })
        if (content) return content
        // Unknown name → list the merged set so the model can pick a real one.
        const merged = mergeSkillIndexes({
          app: ctx.app.index(),
          canvas: await ctx.canvas.list().catch(() => []),
          account: (await ctx.account?.list().catch(() => [])) ?? [],
          agent: await loadAgentSkills(ctx.agent ?? null),
          ...(fs
            ? { repo: await enumerateRepoSkills(fs).catch(() => []) }
            : {}),
        })
        return `Unknown skill: "${name}". Available skills:\n${formatMergedListing(merged)}`
      },
    }),

    save_skill: tool({
      description: [
        "Offer a skill for saving: a procedure later chats should follow, like a review checklist, a house writing style or how this team ships a release. Offer one when the user asks, or when you’ve worked out a procedure worth reusing.",
        "The chat shows it as a card with Save to account and Save to canvas, and nothing is saved until the person presses one; their choice doesn’t come back to you. `canvas` keeps it with this canvas, for every chat on it; `account` keeps it with the person who presses, for every chat they message on any canvas. `scope` is the one you suggest, which the card puts first: `account` for a procedure that’s theirs rather than this canvas’s, like how they like a write-up done.",
        "`content` is the whole SKILL.md: frontmatter with `name` (the skill’s name) and `description` (what it does and when to use it, which is all a chat sees until it loads the skill), then the instructions in markdown. Put longer references or examples in `files`, and say in SKILL.md when to read them.",
        "Saving a name that exists replaces that skill, so change one by offering it again. To change one of Screenplay’s own skills, read it with `read_skill` and offer your changed copy under the same name: once saved, the copy takes its place. `allowed-tools` and lines with an inline !`command` are removed.",
      ].join(" "),
      inputSchema: jsonSchema<
        Scope & { name: string; content: string; files?: SkillFile[] }
      >({
        type: "object",
        properties: {
          scope: scopeProperty,
          name: {
            type: "string",
            description:
              "Lowercase letters, digits and hyphens, at most 64 characters, e.g. `release-checklist`.",
          },
          content: {
            type: "string",
            description: "SKILL.md: frontmatter, then the instructions.",
          },
          files: {
            type: "array",
            description:
              "Supporting text files beside SKILL.md, by path inside the skill’s folder, e.g. `references/style.md`.",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                content: { type: "string" },
              },
              required: ["path", "content"],
            },
          },
        },
        required: ["name", "content"],
      }),
      execute: async ({ name, content, files }) => {
        const prepared = prepareSkill({ name, content, files })
        if (!prepared.ok) return `Error: ${prepared.error}`
        const { stripped } = prepared.value
        const fs = ctx.repo ? await ctx.repo() : null
        const shadowed = fs && (await readRepoSkillBody(fs, name)) !== null
        return [
          `Showed "${name}" to the person as a card with Save to account and Save to canvas. It’s saved only when they press one, and chats can use it from their next turn after that.`,
          ...(stripped.length
            ? [
                `Saving removes ${stripped.join(" and ")}: saved skills can’t grant tools or run commands.`,
              ]
            : []),
          ...(shadowed
            ? [
                `This branch’s repository has a skill named "${name}" too, and in this chat the repository’s wins.`,
              ]
            : ctx.app.read(name) !== null
              ? [
                  `Once saved, it takes the place of Screenplay’s own skill "${name}".`,
                ]
              : []),
        ].join(" ")
      },
    }),

    delete_skill: tool({
      description:
        "Delete a saved skill, so no chat follows it any more. Delete one when the user asks, or one you saved that turned out wrong. It can’t be undone.",
      inputSchema: jsonSchema<Scope & { name: string }>({
        type: "object",
        properties: {
          scope: scopeProperty,
          name: { type: "string" },
        },
        required: ["name"],
      }),
      execute: async ({ scope, name }) => {
        const scoped = skills(scope)
        if (!scoped) return NO_ACCOUNT
        const removed = await scoped.remove(name)
        if (!removed.ok) return `Error: ${removed.error}`
        return `Deleted the ${scope === "account" ? "account" : "canvas"} skill "${name}".`
      },
    }),
  }
  // Skills sit outside the repository: reading one changes nothing, and a
  // save is undone by saving again; a delete can't be.
  return annotateTools(tools, {
    read_skill: { readOnlyHint: true, openWorldHint: false },
    save_skill: { destructiveHint: false, openWorldHint: false },
    delete_skill: { destructiveHint: true, openWorldHint: false },
  })
}

export type SkillTools = ReturnType<typeof buildSkillTools>
