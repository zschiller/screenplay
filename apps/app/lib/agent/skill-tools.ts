import "server-only"

import { jsonSchema, tool, type JSONSchema7 } from "ai"

import { annotateTools } from "@/lib/mcp/tool-server"
import { appSkills, type AppSkillSet } from "@/lib/skills"
import { formatSkillListing, type SkillSources } from "@/lib/skills/sources"
import {
  prepareSkill,
  type SavedSkills,
  type SkillFile,
} from "@/lib/skills/saved"

/**
 * A chat's Skill tools (#1555): `read_skill` loads a Skill from the chat's
 * Skill Sources (`lib/skills/sources.ts`, built by its Chat Target), and
 * `save_skill` and `delete_skill` keep the saved Skills. Every chat kind gets
 * all three. Each write takes a `scope`: `canvas` (the canvas's, shared with
 * its members) or `account` (the turn sender's own, on every canvas, #1558),
 * which a turn nobody sent refuses.
 */
export interface SkillToolContext {
  /** Every Skill the chat sees, in precedence. */
  skills: SkillSources
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
  /**
   * Every App Skill, whose supporting files a saved copy keeps; Screenplay's
   * own by default.
   */
  appSkillSet?: AppSkillSet
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

export function buildSkillTools(ctx: SkillToolContext) {
  /** The scope's Skills, or `null` for account Skills on a turn nobody sent. */
  const saved = (scope: Scope["scope"]): SavedSkills | null =>
    scope === "account" ? (ctx.account ?? null) : ctx.canvas
  const appListing = formatSkillListing(ctx.skills.appIndex())

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
        const content = await ctx.skills.read(name)
        if (content) return content
        // Unknown name → list the merged set so the model can pick a real one.
        return `Unknown skill: "${name}". Available skills:\n${formatSkillListing(await ctx.skills.index())}`
      },
    }),

    save_skill: tool({
      description: [
        "Offer a skill for saving: a procedure later chats should follow, like a review checklist, a house writing style or how this team ships a release. Offer one when the user asks, or when you’ve worked out a procedure worth reusing.",
        "The chat shows it as a card with Save to account and Save to canvas, and nothing is saved until the person presses one; their choice doesn’t come back to you. `canvas` keeps it with this canvas, for every chat on it; `account` keeps it with the person who presses, for every chat they message on any canvas. `scope` is the one you suggest, which the card puts first: `account` for a procedure that’s theirs rather than this canvas’s, like how they like a write-up done.",
        "`content` is the whole SKILL.md: frontmatter with `name` (the skill’s name) and `description` (what it does and when to use it, which is all a chat sees until it loads the skill), then the instructions in markdown. Put longer references or examples in `files`, and say in SKILL.md when to read them.",
        "Saving a name that exists replaces that skill, so change one by offering it again. To change one of Screenplay’s own skills, read it with `read_skill` and offer your changed copy under the same name: once saved, the copy takes its place, and it keeps the original’s files, so pass in `files` only the ones you change. `allowed-tools` and lines with an inline !`command` are removed.",
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
        const { files: all, carried } = (
          ctx.appSkillSet ?? appSkills
        ).carryFiles(name, files)
        const prepared = prepareSkill({ name, content, files: all })
        if (!prepared.ok) return `Error: ${prepared.error}`
        const { stripped } = prepared.value
        const holders = await ctx.skills.holders(name)
        const shadowed = holders.includes("repo")
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
            : holders.includes("app")
              ? [
                  `Once saved, it takes the place of Screenplay’s own skill "${name}".`,
                ]
              : []),
          ...(carried.length
            ? [
                `It keeps ${carried.map((p) => `\`${p}\``).join(", ")} from Screenplay’s own skill.`,
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
        const scoped = saved(scope)
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
