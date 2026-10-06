import { blockText, type ToolCallContent } from "@/lib/agent/acp/schema"
import { bareToolName } from "@/lib/agent/tool-name"

/**
 * The Mockup or Document a tool call is working on (#1725), which the chat
 * store adds to the chat's working list: an update or a read names it in its
 * arguments as soon as they arrive (while they stream, on an Engine that
 * streams them, see {@link layerArgOfPartialInput}), and a create names the
 * new layer in the result it returns. Null for any other call.
 */
export function workingLayerOf(call: {
  title: string
  status?: string
  rawInput?: unknown
  content?: readonly ToolCallContent[]
}): string | null {
  const name = bareToolName(call.title)
  const key = LAYER_ARGS[name]
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

/**
 * The argument that names the layer, per tool that works on one: the updates,
 * reading a Mockup, which shows on it as work too, and `start_editing`, which
 * names it before the update's page is written (on a harness that reports
 * arguments only once they're whole, the update names it only at the end).
 */
export const LAYER_ARGS: Readonly<Record<string, string>> = {
  start_editing: "layer_id",
  update_mockup: "mockup_id",
  read_mockup: "mockup_id",
  replace_document_body: "document_id",
  append_to_document_body: "document_id",
  set_document_title: "document_id",
}

/** Whether a tool names the layer it works on in its arguments. */
export function namesLayer(toolName: string): boolean {
  return bareToolName(toolName) in LAYER_ARGS
}

const CREATES = new Set(["create_mockup", "create_document"])

/**
 * The layer a call names in its arguments while they're still streaming, as
 * soon as its id argument is written out whole: `{"mockup_id":"m-1","html":"<…`
 * names `m-1` long before the page finishes. Null until then, and for a tool
 * that names no layer. Only a top-level key counts, so a page that quotes
 * `"mockup_id"` in its HTML never names one.
 */
export function layerArgOfPartialInput(
  toolName: string,
  partialJson: string
): Record<string, string> | null {
  const key = LAYER_ARGS[bareToolName(toolName)]
  if (!key) return null
  const id = topLevelString(partialJson, key)
  return id ? { [key]: id } : null
}

/** A finished top-level string value of `key` in partial JSON, if there is one. */
function topLevelString(json: string, key: string): string | null {
  let depth = 0
  let i = 0
  while (i < json.length) {
    const ch = json[i]
    if (ch === '"') {
      const end = stringEnd(json, i)
      if (end < 0) return null
      if (depth === 1) {
        const after = /^\s*:\s*/.exec(json.slice(end + 1))
        if (after) {
          const name = JSON.parse(json.slice(i, end + 1)) as string
          const start = end + 1 + after[0].length
          if (name === key) {
            if (json[start] !== '"') return null
            const valueEnd = stringEnd(json, start)
            if (valueEnd < 0) return null
            const value = JSON.parse(json.slice(start, valueEnd + 1))
            return typeof value === "string" && value ? value : null
          }
          i = start
          continue
        }
      }
      i = end + 1
      continue
    }
    if (ch === "{" || ch === "[") depth++
    else if (ch === "}" || ch === "]") depth--
    i++
  }
  return null
}

/** Index of the quote closing the string opening at `start`, or -1 if unfinished. */
function stringEnd(json: string, start: number): number {
  for (let i = start + 1; i < json.length; i++) {
    if (json[i] === "\\") i++
    else if (json[i] === '"') return i
  }
  return -1
}
