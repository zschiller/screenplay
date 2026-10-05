import { blockText, type ToolCallContent } from "@/lib/agent/acp/schema"
import { bareToolName } from "@/lib/agent/tool-name"

/**
 * The Mockup or Document a tool call is changing (#1725), which the chat
 * store adds to the chat's working list: an update names it in its
 * arguments as soon as they arrive (while they stream, on an Engine that
 * streams them), and a create names the new layer in the result it returns.
 * Null for any other call.
 */
export function workingLayerOf(call: {
  title: string
  status?: string
  rawInput?: unknown
  content?: readonly ToolCallContent[]
}): string | null {
  const name = bareToolName(call.title)
  const key = UPDATE_ARGS[name]
  if (key) {
    const input = call.rawInput as Record<string, unknown> | undefined
    const id = input?.[key]
    return typeof id === "string" && id ? id : null
  }
  if (CREATES.has(name) && call.status === "completed") {
    const text = (call.content ?? [])
      .map((c) => (c.type === "content" ? blockText(c.content) : ""))
      .join("")
    return /\(id ([^)\s]+)\)/.exec(text)?.[1] ?? null
  }
  return null
}

/** The argument that names the layer, per update tool. */
const UPDATE_ARGS: Record<string, string> = {
  update_mockup: "mockup_id",
  replace_document_body: "document_id",
  append_to_document_body: "document_id",
  set_document_title: "document_id",
}

const CREATES = new Set(["create_mockup", "create_document"])
