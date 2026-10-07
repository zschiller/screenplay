import { blockText, type ToolCallContent } from "@/lib/agent/acp/schema"
import type { AgentMessage } from "@/lib/agent/types"
import { bareToolName } from "@/lib/agent/tool-name"

/**
 * The Documents and Mockups a turn delivered (#1885, spec #1882), which its
 * reply shows as tiles: each one a create or a write made, in the order first
 * made or changed. A read, `start_editing` and a refused or failed write
 * deliver nothing. Ids are as the calls name them, a view's or a file's; the
 * tiles resolve each to its file.
 */

/** Each write's id argument and the start of the result it returns on success. */
const WRITES: Readonly<Record<string, { arg: string; ok: string }>> = {
  update_mockup: { arg: "mockup_id", ok: "Updated Mockup" },
  replace_document_body: { arg: "document_id", ok: "Replaced document body" },
  append_to_document_body: { arg: "document_id", ok: "Appended" },
  set_document_title: { arg: "document_id", ok: "Title set to" },
}

const CREATES = new Set(["create_mockup", "create_document"])

type ToolCall = {
  title: string
  status?: string
  rawInput?: unknown
  content?: readonly ToolCallContent[]
}

function resultText(call: ToolCall): string {
  return (call.content ?? [])
    .map((c) => (c.type === "content" ? blockText(c.content) : ""))
    .join("")
    .trim()
}

/** The Document or Mockup one call delivered, or null. */
export function deliveredFileOf(call: ToolCall): string | null {
  if (call.status !== "completed") return null
  const name = bareToolName(call.title)
  const text = resultText(call)
  if (CREATES.has(name)) {
    if (!text.startsWith("Created")) return null
    return /\(id ([^)\s]+)\)/.exec(text)?.[1] ?? null
  }
  const write = WRITES[name]
  if (!write || !text.startsWith(write.ok)) return null
  const id = (call.rawInput as Record<string, unknown> | undefined)?.[write.arg]
  return typeof id === "string" && id ? id : null
}

/** Every file a run of messages delivered, once each, in order. */
export function deliveredFiles(messages: readonly AgentMessage[]): string[] {
  const ids: string[] = []
  for (const message of messages) {
    if (message.role !== "tool_call") continue
    const id = deliveredFileOf(message)
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}
