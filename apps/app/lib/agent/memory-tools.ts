import "server-only"

import { jsonSchema, tool } from "ai"

import { annotateTools } from "@/lib/mcp/tool-server"
import {
  addAccountMemory,
  editAccountMemory,
  removeAccountMemory,
  type AccountMemoryStore,
} from "@/lib/memory/account"
import {
  addMemory,
  editMemory,
  MEMORY_ENTRY_MAX_LENGTH,
  removeMemory,
} from "@/lib/memory/canvas"
import type { MemoryData } from "@/lib/types"
import type { RoomCollections } from "@/lib/yjs/schema"

/**
 * A chat's memory tool (#1515): `write_memory` adds, edits and removes entries
 * of account memory (the sender's preferences, on every canvas) and canvas
 * memory (this canvas's facts, shared with its members). Every chat kind gets
 * it, in process and over the harness MCP route. Saves act right away and
 * show as an ordinary tool row.
 */
export interface MemoryToolContext {
  /** The canvas's Y.Doc, where canvas memory lives. */
  canvas: {
    mutateDoc<T>(fn: (collections: RoomCollections) => T): Promise<T>
  }
  /**
   * The account memory of the person who sent the turn; `null` on a turn
   * nobody sent (a Coordinator wake and the turns it delegates), which refuses
   * account writes.
   */
  account: AccountMemoryStore | null
}

export type MemoryScope = "account" | "canvas"

type WriteMemoryInput = {
  scope?: MemoryScope
  action: "add" | "edit" | "remove"
  id?: string
  text?: string
}

/** The verbs of one scope, so the tool reads the same for both. */
interface ScopeVerbs {
  add(text: string): Promise<MemoryData | null>
  edit(id: string, text: string): Promise<boolean>
  remove(id: string): Promise<boolean>
}

export function buildMemoryTools(ctx: MemoryToolContext) {
  const canvas: ScopeVerbs = {
    add: (text) =>
      ctx.canvas.mutateDoc((c) => addMemory(c, { text, source: "agent" })),
    edit: (id, text) =>
      ctx.canvas.mutateDoc((c) => editMemory(c, id, { text })),
    remove: (id) => ctx.canvas.mutateDoc((c) => removeMemory(c, id)),
  }
  const account = ctx.account
  const accountVerbs: ScopeVerbs | null = account && {
    add: (text) => addAccountMemory(account, { text, source: "agent" }),
    edit: (id, text) => editAccountMemory(account, id, { text }),
    remove: (id) => removeAccountMemory(account, id),
  }

  const tools = {
    write_memory: tool({
      description: [
        "Add, edit or remove a memory entry: a short note every later chat reads in its system prompt.",
        "`account` memory is the personal preferences of the person who sent this message (how they like to work, write or be answered); it follows them to every canvas. `canvas` memory is facts about this canvas's work (decisions, conventions, facts about its repositories), shared with its members.",
        `Add one short, self-contained sentence per entry (at most ${MEMORY_ENTRY_MAX_LENGTH} characters). Edit or remove by the id shown in brackets in your prompt's Account memory or Canvas memory block. Never save secrets or credentials.`,
      ].join(" "),
      inputSchema: jsonSchema<WriteMemoryInput>({
        type: "object",
        properties: {
          scope: {
            type: "string",
            enum: ["account", "canvas"],
            description:
              "`account` for the sender's personal preferences, `canvas` for facts about this canvas's work.",
          },
          action: { type: "string", enum: ["add", "edit", "remove"] },
          id: {
            type: "string",
            description: "The entry to edit or remove. Not used for add.",
          },
          text: {
            type: "string",
            description: "The entry's text, for add and edit.",
          },
        },
        required: ["scope", "action"],
      }),
      execute: async (input) => {
        const scope: MemoryScope =
          input.scope === "account" ? "account" : "canvas"
        const verbs = scope === "account" ? accountVerbs : canvas
        if (!verbs) {
          return "Nothing saved: nobody sent this turn, so it has no account memory. Save to `canvas` instead."
        }
        return writeMemory(verbs, scope, input)
      },
    }),
  }
  // Memory sits outside the repository, and the spec lets saves act right
  // away (#1515): an edit or remove changes only a note.
  return annotateTools(tools, {
    write_memory: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  })
}

export type MemoryTools = ReturnType<typeof buildMemoryTools>

async function writeMemory(
  verbs: ScopeVerbs,
  scope: MemoryScope,
  { action, id, text }: WriteMemoryInput
): Promise<string> {
  const where = `${scope} memory`
  if (action === "add") {
    if (!text?.trim()) return "Nothing saved: an entry needs text."
    const entry = await verbs.add(text)
    return entry
      ? `Saved to ${where}: [${entry.id}] ${entry.text}`
      : "Nothing saved."
  }
  if (!id) return `Nothing changed: ${action} needs the entry's id.`
  if (action === "edit") {
    if (!text?.trim()) return "Nothing changed: an edit needs text."
    return (await verbs.edit(id, text))
      ? `Updated [${id}] in ${where}.`
      : `No ${where} entry [${id}].`
  }
  return (await verbs.remove(id))
    ? `Removed [${id}] from ${where}.`
    : `No ${where} entry [${id}].`
}
