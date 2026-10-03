import type { AgentMessage } from "@/lib/agent/types"
import { bareToolName } from "@/lib/agent/tool-name"

/**
 * One vocabulary for every engine's tool rows (the 2026-10-03 tool-row
 * audit): a row is a verb plus what it acted on. The subject is code (a
 * path, pattern, command or selector), plain text (a label someone sees, a
 * query, a Workspace's title) or a key, and every row draws it in the UI
 * font.
 */
export type RowLabel = {
  verb: string
  detail?: string
  as?: "code" | "text" | "key"
  icon?: string
}

type Call = AgentMessage & { role: "tool_call" }

/** Frame Drive steps that act on the page; a drive folds them into one row. */
export const DRIVE_GESTURES = new Set([
  "frame_click",
  "frame_type",
  "frame_key",
  "frame_scroll",
  "frame_select",
  "frame_drag",
  "frame_hover",
])

const str = (v: unknown) => (typeof v === "string" && v ? v : null)

function record(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {}
}

function resultText(call: Call): string {
  return call.content
    .map((b) =>
      b.type === "content" && b.content.type === "text" ? b.content.text : ""
    )
    .join("")
}

/** The name and input of a call, unwrapping Codex's `mcp.<server>.<tool>`. */
export function callIdentity(call: Call): {
  name: string
  input: Record<string, unknown>
} {
  const name = bareToolName(call.title)
  // codex-acp 2 wraps an MCP call's input as `{ server, tool, arguments }`.
  const input = /^mcp\./.test(call.title)
    ? record(record(call.rawInput).arguments)
    : record(call.rawInput)
  return { name, input }
}

/** A repo-relative path: the tail an adapter's own title shows, if any. */
export function relativePath(path: string, title: string): string {
  if (!path.startsWith("/")) return path
  const tokens = title.replace(/[`'"]/g, " ").split(/\s+/)
  const tail = tokens.find(
    (t) => t && !t.startsWith("/") && path.endsWith(`/${t}`)
  )
  if (tail) return tail
  const parts = path.split("/")
  return parts.slice(-3).join("/")
}

/** A selector's last step, which is usually the part that names the element. */
function shortSelector(selector: string): string {
  const last =
    selector
      .split(/\s*>\s*|\s+/)
      .filter(Boolean)
      .at(-1) ?? selector
  return last.length > 32 ? `${last.slice(0, 31)}…` : last
}

function driveTarget(
  t: unknown,
  result: string
): Pick<RowLabel, "detail" | "as"> {
  // What the page says it acted on beats how the agent pointed at it.
  const acted = result.match(/^Did \w+ on \w+ "([^"]+)"/)
  if (acted) return { detail: acted[1], as: "text" }
  const r = record(t)
  if (str(r.text)) return { detail: str(r.text)!, as: "text" }
  if (str(r.selector))
    return { detail: shortSelector(str(r.selector)!), as: "code" }
  if (typeof r.x === "number" && typeof r.y === "number") {
    return { detail: `at ${Math.round(r.x)}, ${Math.round(r.y)}`, as: "text" }
  }
  return {}
}

function host(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`
  } catch {
    return url
  }
}

/** Codex's prose titles, read back into verb + subject. */
function codexProse(title: string): RowLabel | null {
  let m = title.match(/^Read file '(.+)'$/)
  if (m) return { verb: "Read", detail: m[1], as: "code" }
  m = title.match(/^Search for '(.+?)'(?: in (.+))?$/)
  if (m) return { verb: "Search", detail: m[1], as: "code", icon: "search" }
  m = title.match(/^List files in '(.+)'$/)
  if (m) return { verb: "List files", detail: m[1], as: "code", icon: "folder" }
  m = title.match(/^Web search: (.+)$/)
  if (m)
    return { verb: "Search the web", detail: m[1], as: "text", icon: "globe" }
  m = title.match(/^Open page: (.+)$/)
  if (m) return { verb: "Open", detail: host(m[1]!), as: "code", icon: "globe" }
  m = title.match(/^View Image (.+)$/)
  if (m)
    return {
      verb: "Look at image",
      detail: m[1]!.split("/").at(-1),
      as: "code",
      icon: "eye",
    }
  if (title === "Editing files" || title === "Edit files") return null
  m = title.match(/^Start subagent (.+)$/)
  if (m)
    return { verb: "Start subagent", detail: m[1], as: "text", icon: "robot" }
  if (/^mcp__[^_]+(?:_[^_]+)*__startup$/.test(title)) {
    return { verb: "Screenplay's tools didn't start", icon: "warning" }
  }
  return null
}

/** Claude Code's built-in tools, by the title claude-agent-acp gives them. */
function claudeCodeBuiltIn(
  call: Call,
  input: Record<string, unknown>
): RowLabel | null {
  const t = call.title
  if (t === "Skill")
    return {
      verb: "Read skill",
      detail: str(input.skill) ?? undefined,
      as: "code",
      icon: "skill",
    }
  if (call.kind === "search" && t.startsWith("grep")) {
    return {
      verb: "Search",
      detail: str(input.pattern) ?? undefined,
      as: "code",
      icon: "search",
    }
  }
  if (call.kind === "search" && t.startsWith("Find")) {
    return {
      verb: "Find files",
      detail: str(input.pattern) ?? undefined,
      as: "code",
      icon: "folder",
    }
  }
  if (call.kind === "fetch" && str(input.url)) {
    return {
      verb: "Fetch",
      detail: host(str(input.url)!),
      as: "code",
      icon: "globe",
    }
  }
  if (call.kind === "fetch" && str(input.query)) {
    return {
      verb: "Search the web",
      detail: str(input.query)!,
      as: "text",
      icon: "globe",
    }
  }
  if (t === "NotebookEdit") {
    const p = str(input.notebook_path)
    return {
      verb: "Edit notebook",
      detail: p ? relativePath(p, t) : undefined,
      as: "code",
      icon: "edit",
    }
  }
  return null
}

/**
 * The row label for a call, or null to fall back on the tool's own title
 * and the renderer's per-tool details.
 */
export function rowLabel(
  call: Call,
  workspaceTitle: (id: string) => string | null
): RowLabel | null {
  const { name, input } = callIdentity(call)
  const result = resultText(call)
  const ws = (id: unknown) => (str(id) ? workspaceTitle(str(id)!) : null)
  switch (name) {
    case "grep":
    case "search_code":
      return {
        verb: "Search",
        detail: str(input.pattern) ?? undefined,
        as: "code",
        icon: "search",
      }
    case "glob":
    case "find_code_files":
      return {
        verb: "Find files",
        detail: str(input.pattern) ?? undefined,
        as: "code",
        icon: "folder",
      }
    case "create_mockup":
      return {
        verb: "Create mockup",
        detail: str(input.title) ?? undefined,
        as: "text",
        icon: "mockup",
      }
    case "update_mockup":
      return {
        verb: "Update mockup",
        detail: str(input.title) ?? undefined,
        as: "text",
        icon: "mockup",
      }
    case "read_mockup":
      return { verb: "Read mockup", icon: "mockup" }
    case "start_chat":
      return {
        verb: "Start chat",
        detail: str(input.title) ?? undefined,
        as: "text",
        icon: "chat",
      }
    case "send_to_chat":
      return { verb: "Send to chat", icon: "send" }
    case "read_workspace_chat":
    case "read_workspace_diff":
    case "stop_workspace": {
      const title = ws(input.workspaceId ?? input.workspace_id)
      const verb = {
        read_workspace_chat: "Read chat in",
        read_workspace_diff: "Read changes in",
        stop_workspace: "Stop",
      }[name]
      return title ? { verb, detail: title, as: "text" } : null
    }
    case "frame_click":
      return { verb: "Click", ...driveTarget(input.target, result) }
    case "frame_hover":
      return { verb: "Hover", ...driveTarget(input.target, result) }
    case "frame_type": {
      const text = str(input.text)
      return text
        ? { verb: "Type", detail: `“${text}”`, as: "text" }
        : { verb: "Type" }
    }
    case "frame_key": {
      const mods = record(input.modifiers)
      const keys = [
        mods.metaKey && "⌘",
        mods.ctrlKey && "Ctrl",
        mods.altKey && "⌥",
        mods.shiftKey && "⇧",
        str(input.key),
      ].filter((k): k is string => !!k)
      return { verb: "Press", detail: keys.join(" "), as: "key" }
    }
    case "frame_scroll": {
      const dy = typeof input.dy === "number" ? input.dy : 0
      const dx = typeof input.dx === "number" ? input.dx : 0
      const dir =
        dy > 0
          ? "down"
          : dy < 0
            ? "up"
            : dx > 0
              ? "right"
              : dx < 0
                ? "left"
                : null
      return { verb: dir ? `Scroll ${dir}` : "Scroll" }
    }
    case "frame_select":
      return { verb: "Pick", detail: str(input.value) ?? undefined, as: "text" }
    case "frame_drag": {
      const from = driveTarget(input.target, "")
      const to = driveTarget(input.to, "")
      return {
        verb: "Drag",
        detail:
          from.detail && to.detail
            ? `${from.detail} to ${to.detail.replace(/^at /, "")}`
            : from.detail,
        as: from.as,
      }
    }
    case "frame_elements":
      return { verb: "Read the page" }
  }
  return codexProse(call.title) ?? claudeCodeBuiltIn(call, input)
}

const FRAME_NAME = /\bframe \[[^\]]+\] \((\S*)(?: in Workspace "([^"]+)")?\)/g
const MOCKUP_NAME = /\bMockup \[[^\]]+\](?: \("([^"]+)"\))?/g

/**
 * A frame tool's result with the names it gives the agent (`frame [id]
 * (/route in Workspace "Title")`, `Mockup [id] ("Title")`) read as a person
 * would say them: `Title /route`, `Title`.
 */
export function readableFrameNames(text: string): string {
  return text
    .replace(FRAME_NAME, (_, route: string, title?: string) =>
      title ? `${title} ${route || "/"}` : `frame ${route || "/"}`
    )
    .replace(MOCKUP_NAME, (_, title?: string) => title ?? "the mockup")
}

/**
 * What a Frame Drive's steps call the page they drove, read from their
 * results (`frame [id] (/route in Workspace "Title")`, `Mockup [id]
 * ("Title")`): the Workspace's or Mockup's title, else the frame's route.
 * Null before any step has answered.
 */
export function driveName(calls: Call[]): string | null {
  for (const call of calls) {
    const text = resultText(call)
    const frame = text.match(
      /\bframe \[[^\]]+\] \((\S*)(?: in Workspace "([^"]+)")?\)/
    )
    if (frame) return frame[2] ?? (frame[1] || "/")
    const mockup = text.match(/\bMockup \[[^\]]+\](?: \("([^"]+)"\))?/)
    if (mockup) return mockup[1] ?? "the mockup"
  }
  return null
}
