import type { AgentMessage } from "@/lib/agent/types"
import type { ToolKind } from "@/lib/agent/acp/schema"
import { bareToolName } from "@/lib/agent/tool-name"

/**
 * One Tool Description (#1488): everything the chat shows about a tool call,
 * from any engine, read in one place. The tool row, the turn summary, drive
 * folding and the in-process engine's ACP kinds all take it from here, so
 * adding a tool is one entry in {@link SCREENPLAY_TOOLS} and a harness's
 * built-in tool reads the same as ours when it does the same thing.
 */

export type ToolCallMessage = Extract<AgentMessage, { role: "tool_call" }>

/**
 * A row reads as a verb plus what it acted on (the 2026-10-03 tool-row
 * audit). The subject is code (a path, pattern, command or selector), plain
 * text (a label someone sees, a query, a Workspace's title) or a key, and
 * every row draws it in the UI font. `title` marks a call nothing here could
 * structure: `verb` is the adapter's own title, whose backtick spans are its
 * subjects.
 */
export type RowLabel = {
  verb: string
  detail?: string
  as?: "code" | "text" | "key"
  title?: true
}

/** The icon a row shows when done; the view maps each name to a glyph. */
export type ToolIcon =
  | "file"
  | "file-plus"
  | "edit"
  | "rename"
  | "note"
  | "terminal"
  | "folder"
  | "search"
  | "pull-request"
  | "skill"
  | "logs"
  | "restart"
  | "stop"
  | "play"
  | "canvas"
  | "chat"
  | "chat-text"
  | "diff"
  | "eye"
  | "code"
  | "cursor"
  | "window"
  | "list"
  | "scroll"
  | "select"
  | "memory"
  | "move"
  | "layout"
  | "selection"
  | "merge"
  | "trash"
  | "history"
  | "undo"
  | "crosshair"
  | "workspaces"
  | "stop-circle"
  | "question"
  | "mockup"
  | "send"
  | "globe"
  | "robot"
  | "warning"
  | "fetch"
  | "think"
  | "check"

/**
 * How a row draws its result text: as markdown, as a log (with its ANSI
 * colours), as prose in the UI font, or preformatted. A file read whose
 * language is known draws as highlighted code instead (see `readPath`).
 */
export type ToolOutput = "plain" | "markdown" | "log" | "prose"

/** What a call counts as in a folded turn's summary line. */
export type SummaryCategory =
  | "read"
  | "edit"
  | "readDoc"
  | "editDoc"
  | "canvas"
  | "run"
  | "search"
  | "readCanvas"
  | "readWorkspace"
  | "viewFrame"
  | "listChanges"
  | "memory"
  | "view"
  | "drive"

export interface ToolDescription {
  /** The tool's own name, without a harness's MCP namespace. */
  name: string
  label: RowLabel
  icon: ToolIcon
  output: ToolOutput
  /**
   * The result only says the label again (a gesture's "Did click…", a
   * canvas change's outcome line), so the row has nothing to open onto.
   */
  quiet: boolean
  /** The file a read returned, whose extension picks the highlighting. */
  readPath: string | null
  /** How the result text is reworded before it's shown. */
  rewrite: "frame-names" | "command-output" | null
  /** Its summary category; null counts as "other tools". */
  category: SummaryCategory | null
  /** What repeats of it share in a summary (a file, a Workspace, a frame). */
  summaryKey: string | null
  /** The shortest name that says this call failed ("pnpm lint", "Read"). */
  failure: string
  /** A Frame Drive step: any frame tool but opening a new frame. */
  driveStep: boolean
  /** A drive step that acts on the page; a drive folds only with one. */
  gesture: boolean
  /** The frame a drive step acts on; "" for the chat's own frame. */
  frameId: string
}

type Input = Record<string, unknown>
type Context = { workspaceTitle?: (id: string) => string | null }

interface ToolEntry {
  verb: string
  icon: ToolIcon
  /** The ACP kind the in-process engine reports it with. */
  kind: ToolKind
  output?: ToolOutput | "quiet" | "outcome"
  category?: SummaryCategory
  /** A frame step that acts on the page. */
  gesture?: true
  /** A file read: its row leads with the lines it returned. */
  fileRead?: true
  /**
   * Its subject (and, for some, a verb of its own). Without one, a path in
   * its input is the subject; returning null keeps the plain verb.
   */
  label?: (
    input: Input,
    result: string,
    ctx: Context
  ) => Partial<RowLabel> | null
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null)

function record(raw: unknown): Input {
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Input)
    : {}
}

const subject =
  (key: string, as: RowLabel["as"]) =>
  (input: Input): Partial<RowLabel> | null =>
    str(input[key]) ? { detail: str(input[key])!, as } : null

const inWorkspace =
  (verb: string) =>
  (input: Input, _: string, ctx: Context): Partial<RowLabel> | null => {
    const id = str(input.workspaceId ?? input.workspace_id)
    const title = id ? (ctx.workspaceTitle?.(id) ?? null) : null
    return title ? { verb, detail: title, as: "text" } : null
  }

/** A GitHub issue or pull request call's row: "Close #12". */
const issueNumber =
  (verb: string) =>
  (input: Input): Partial<RowLabel> | null =>
    typeof input.number === "number"
      ? { verb, detail: `#${input.number}`, as: "text" }
      : { verb }

/** A selector's last step, which is usually the part that names the element. */
function shortSelector(selector: string): string {
  const last =
    selector
      .split(/\s*>\s*|\s+/)
      .filter(Boolean)
      .at(-1) ?? selector
  return last.length > 32 ? `${last.slice(0, 31)}…` : last
}

function driveTarget(t: unknown, result: string): Partial<RowLabel> {
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

/** A command call's command line: its `command` plus `args`. */
function commandOf(input: Input): string | null {
  const line = [input.command, ...((input.args as unknown[] | undefined) ?? [])]
    .filter((w): w is string => typeof w === "string" && w !== "")
    .join(" ")
  return line || null
}

/**
 * Every tool Screenplay serves, in-process or over MCP to a harness. A test
 * fails when a tool in any chat's toolset has no entry here.
 */
export const SCREENPLAY_TOOLS: Record<string, ToolEntry> = {
  // A Workspace chat's own code.
  read_file: {
    verb: "Read",
    icon: "file",
    kind: "read",
    category: "read",
    fileRead: true,
  },
  write_file: { verb: "Write", icon: "file", kind: "edit", category: "edit" },
  edit_file: { verb: "Edit", icon: "edit", kind: "edit", category: "edit" },
  run_command: {
    verb: "Run command",
    icon: "terminal",
    kind: "execute",
    output: "log",
    category: "run",
    label: (input) => {
      const command = commandOf(input)
      return command ? { detail: command, as: "code" } : null
    },
  },
  // Searches and listings: their `path` is a directory, never a file read.
  list_files: {
    verb: "List files",
    icon: "folder",
    kind: "search",
    category: "search",
  },
  grep: {
    verb: "Search",
    icon: "search",
    kind: "search",
    category: "search",
    label: subject("pattern", "code"),
  },
  glob: {
    verb: "Find files",
    icon: "folder",
    kind: "search",
    category: "search",
    label: subject("pattern", "code"),
  },
  submit_plan: { verb: "Submit plan", icon: "terminal", kind: "other" },
  create_pr: {
    verb: "Create pull request",
    icon: "pull-request",
    kind: "other",
  },
  // The canvas's GitHub issues and pull requests, and their comments.
  search_issues: {
    verb: "Search issues",
    icon: "search",
    kind: "search",
    category: "search",
    label: subject("query", "text"),
  },
  read_issue: {
    verb: "Read",
    icon: "chat-text",
    kind: "read",
    output: "markdown",
    label: issueNumber("Read"),
  },
  create_issue: {
    verb: "Create issue",
    icon: "note",
    kind: "other",
    label: subject("title", "text"),
  },
  comment_on_issue: {
    verb: "Comment",
    icon: "chat",
    kind: "other",
    label: issueNumber("Comment on"),
  },
  update_issue: {
    verb: "Update",
    icon: "edit",
    kind: "other",
    label: (input) => {
      const verb =
        input.state === "closed"
          ? "Close"
          : input.state === "open"
            ? "Reopen"
            : "Update"
      return issueNumber(verb)(input)
    },
  },
  link_issues: {
    verb: "Link",
    icon: "list",
    kind: "other",
    label: (input) =>
      typeof input.number === "number" && typeof input.other === "number"
        ? {
            verb: input.remove ? "Unlink" : "Link",
            detail: `#${input.number} and #${input.other}`,
            as: "text",
          }
        : null,
  },
  list_labels: { verb: "List labels", icon: "list", kind: "read" },
  review_pr: {
    verb: "Review",
    icon: "eye",
    kind: "other",
    label: (input) => {
      const verb =
        input.event === "approve"
          ? "Approve"
          : input.event === "request_changes"
            ? "Request changes on"
            : "Review"
      return issueNumber(verb)(input)
    },
  },
  merge_pr: {
    verb: "Offer to merge",
    icon: "merge",
    kind: "other",
    label: issueNumber("Offer to merge"),
  },
  mark_done: { verb: "Mark chat done", icon: "check", kind: "other" },
  read_pr_diff: {
    verb: "Read diff of",
    icon: "diff",
    kind: "read",
    label: issueNumber("Read diff of"),
  },
  read_pr_checks: {
    verb: "Read checks of",
    icon: "list",
    kind: "read",
    label: issueNumber("Read checks of"),
  },
  read_skill: {
    verb: "Read skill",
    icon: "skill",
    kind: "read",
    output: "markdown",
    label: subject("name", "code"),
  },
  // The canvas's saved Skills (#1555).
  save_skill: {
    verb: "Save skill",
    icon: "skill",
    kind: "edit",
    category: "edit",
    label: subject("name", "code"),
  },
  read_dev_server_logs: {
    verb: "Read dev server logs",
    icon: "logs",
    kind: "other",
    output: "log",
  },
  start_dev_server: {
    verb: "Start dev server",
    icon: "play",
    kind: "other",
    output: "log",
  },
  restart_dev_server: {
    verb: "Restart dev server",
    icon: "restart",
    kind: "other",
    output: "log",
  },
  stop_dev_server: { verb: "Stop dev server", icon: "stop", kind: "other" },
  // Other Workspaces' code (#1315).
  read_code_file: {
    verb: "Read code",
    icon: "file",
    kind: "read",
    category: "read",
    fileRead: true,
  },
  search_code: {
    verb: "Search",
    icon: "search",
    kind: "search",
    category: "search",
    label: subject("pattern", "code"),
  },
  find_code_files: {
    verb: "Find files",
    icon: "folder",
    kind: "search",
    category: "search",
    label: subject("pattern", "code"),
  },
  // Documents.
  read_document: {
    verb: "Read document",
    icon: "file",
    kind: "read",
    output: "markdown",
    category: "readDoc",
  },
  replace_document_body: {
    verb: "Rewrite document",
    icon: "note",
    kind: "edit",
    category: "editDoc",
  },
  append_to_document_body: {
    verb: "Append to document",
    icon: "note",
    kind: "edit",
    category: "editDoc",
  },
  set_document_title: {
    verb: "Set title",
    icon: "rename",
    kind: "edit",
    category: "editDoc",
    label: subject("title", "text"),
  },
  // Mockups.
  create_mockup: {
    verb: "Create mockup",
    icon: "mockup",
    kind: "other",
    output: "quiet",
    label: subject("title", "text"),
  },
  update_mockup: {
    verb: "Update mockup",
    icon: "mockup",
    kind: "other",
    output: "quiet",
    label: subject("title", "text"),
  },
  read_mockup: {
    verb: "Read mockup",
    icon: "mockup",
    kind: "other",
    output: "prose",
    label: () => null,
  },
  // The Coordinator's reads (#893).
  read_canvas: {
    verb: "Read canvas",
    icon: "canvas",
    kind: "read",
    output: "markdown",
    category: "readCanvas",
  },
  read_workspace_chat: {
    verb: "Read chat",
    icon: "chat-text",
    kind: "read",
    output: "markdown",
    category: "readWorkspace",
    label: inWorkspace("Read chat in"),
  },
  read_workspace_diff: {
    verb: "Read chat changes",
    icon: "diff",
    kind: "read",
    category: "readWorkspace",
    label: inWorkspace("Read changes in"),
  },
  read_workspace_file: {
    verb: "Read chat file",
    icon: "file",
    kind: "read",
    category: "read",
    fileRead: true,
  },
  list_changes: {
    verb: "List changes",
    icon: "history",
    kind: "read",
    output: "markdown",
    category: "listChanges",
  },
  write_memory: {
    verb: "Save to memory",
    icon: "memory",
    kind: "other",
    category: "memory",
    // "Save to account memory", "Edit canvas memory", "Remove from account
    // memory" (#1515), with the entry's text when there is one.
    label: (input) => {
      const where =
        input.scope === "account"
          ? "account memory"
          : input.scope === "canvas"
            ? "canvas memory"
            : "memory"
      const verb =
        input.action === "edit"
          ? `Edit ${where}`
          : input.action === "remove"
            ? `Remove from ${where}`
            : `Save to ${where}`
      const text = str(input.text)
      return text ? { verb, detail: text, as: "text" } : { verb }
    },
  },
  // The canvas's saved files (#1514).
  list_saved_files: {
    verb: "List saved files",
    icon: "folder",
    kind: "search",
    category: "search",
    label: subject("folder", "code"),
  },
  read_saved_file: {
    verb: "Open saved file",
    icon: "file",
    kind: "read",
    category: "read",
  },
  save_file: {
    verb: "Save file",
    icon: "file-plus",
    kind: "edit",
    category: "edit",
  },
  move_saved_file: {
    verb: "Move saved file",
    icon: "move",
    kind: "move",
    category: "edit",
  },
  delete_saved_file: {
    verb: "Delete saved file",
    icon: "trash",
    kind: "delete",
    category: "edit",
  },
  make_saved_folder: {
    verb: "Make folder",
    icon: "folder",
    kind: "edit",
    category: "edit",
  },
  // Frames: viewing one, and opening one to drive (#1390).
  view_frame: {
    verb: "View frame",
    icon: "eye",
    kind: "read",
    category: "viewFrame",
  },
  read_frame_html: {
    verb: "Read frame HTML",
    icon: "code",
    kind: "read",
    category: "viewFrame",
  },
  screenshot_page: {
    verb: "Screenshot page",
    icon: "eye",
    kind: "read",
    category: "viewFrame",
    label: (input) => {
      const page = str(input.url) ?? str(input.route)
      return page ? { detail: page, as: "code" } : null
    },
  },
  frame_screenshot: {
    verb: "Screenshot frame",
    icon: "eye",
    kind: "read",
    category: "viewFrame",
  },
  frame_elements: {
    verb: "Read the page",
    icon: "list",
    kind: "read",
    output: "prose",
    category: "viewFrame",
    label: () => null,
  },
  frame_open: {
    verb: "Open frame",
    icon: "window",
    kind: "other",
    category: "canvas",
    label: subject("route", "code"),
  },
  // Driving a frame (#1389, #1390): every step counts toward one frame.
  frame_start_driving: {
    verb: "Take control",
    icon: "cursor",
    kind: "other",
    category: "drive",
  },
  frame_stop_driving: {
    verb: "Give back control",
    icon: "stop",
    kind: "other",
    category: "drive",
  },
  frame_click: {
    verb: "Click",
    icon: "cursor",
    kind: "other",
    category: "drive",
    gesture: true,
    label: (input, result) => driveTarget(input.target, result),
  },
  frame_hover: {
    verb: "Hover",
    icon: "cursor",
    kind: "other",
    category: "drive",
    gesture: true,
    label: (input, result) => driveTarget(input.target, result),
  },
  frame_type: {
    verb: "Type",
    icon: "edit",
    kind: "other",
    category: "drive",
    gesture: true,
    label: (input) =>
      str(input.text) ? { detail: `“${str(input.text)}”`, as: "text" } : null,
  },
  frame_key: {
    verb: "Press",
    icon: "cursor",
    kind: "other",
    category: "drive",
    gesture: true,
    label: (input) => {
      const mods = record(input.modifiers)
      const keys = [
        mods.metaKey && "⌘",
        mods.ctrlKey && "Ctrl",
        mods.altKey && "⌥",
        mods.shiftKey && "⇧",
        str(input.key),
      ].filter((k): k is string => !!k)
      return { detail: keys.join(" "), as: "key" }
    },
  },
  frame_scroll: {
    verb: "Scroll",
    icon: "scroll",
    kind: "other",
    category: "drive",
    gesture: true,
    label: (input) => {
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
      return dir ? { verb: `Scroll ${dir}` } : null
    },
  },
  frame_select: {
    verb: "Pick",
    icon: "select",
    kind: "other",
    category: "drive",
    gesture: true,
    label: subject("value", "text"),
  },
  frame_drag: {
    verb: "Drag",
    icon: "cursor",
    kind: "other",
    category: "drive",
    gesture: true,
    label: (input) => {
      const from = driveTarget(input.target, "")
      const to = driveTarget(input.to, "")
      return {
        detail:
          from.detail && to.detail
            ? `${from.detail} to ${to.detail.replace(/^at /, "")}`
            : from.detail,
        as: from.as,
      }
    },
  },
  // The Coordinator's canvas changes (#894), whose results name what they
  // did; and the view it moves.
  create_frames: {
    verb: "Create frames",
    icon: "window",
    kind: "edit",
    output: "outcome",
    category: "canvas",
  },
  create_document: {
    verb: "Create document",
    icon: "file-plus",
    kind: "edit",
    output: "outcome",
    category: "canvas",
  },
  move_group: {
    verb: "Move group",
    icon: "move",
    kind: "move",
    output: "outcome",
    category: "canvas",
  },
  arrange_groups: {
    verb: "Arrange groups",
    icon: "layout",
    kind: "move",
    output: "outcome",
    category: "canvas",
  },
  move_to_group: {
    verb: "Move to group",
    icon: "selection",
    kind: "move",
    output: "outcome",
    category: "canvas",
  },
  merge_groups: {
    verb: "Merge groups",
    icon: "merge",
    kind: "move",
    output: "outcome",
    category: "canvas",
  },
  rename: {
    verb: "Rename",
    icon: "rename",
    kind: "edit",
    output: "outcome",
    category: "canvas",
  },
  remove: {
    verb: "Remove",
    icon: "trash",
    kind: "delete",
    output: "outcome",
    category: "canvas",
  },
  undo_changes: {
    verb: "Undo changes",
    icon: "undo",
    kind: "edit",
    output: "outcome",
    category: "canvas",
  },
  show_on_canvas: {
    verb: "Show on canvas",
    icon: "crosshair",
    kind: "read",
    output: "outcome",
    category: "view",
  },
  // The Coordinator's chats: starting, steering and ending them. A PR or
  // removal's result is what it did or why it didn't (#1231).
  create_workspaces: { verb: "Start chats", icon: "workspaces", kind: "other" },
  send_to_workspace: { verb: "Send to chat", icon: "send", kind: "other" },
  start_chat: {
    verb: "Start chat",
    icon: "chat",
    kind: "other",
    label: subject("title", "text"),
  },
  send_to_chat: { verb: "Send to chat", icon: "send", kind: "other" },
  stop_workspace: {
    verb: "Stop chat",
    icon: "stop-circle",
    kind: "other",
    label: inWorkspace("Stop"),
  },
  open_pull_request: {
    verb: "Create pull request",
    icon: "pull-request",
    kind: "other",
    output: "outcome",
  },
  remove_workspace: {
    verb: "Delete chat",
    icon: "trash",
    kind: "other",
    output: "outcome",
  },
  ask_question: { verb: "Ask a question", icon: "question", kind: "other" },
}

/**
 * The ACP kind the in-process engine reports one of its tools with; a
 * harness supplies its own. Anything unknown is `"other"`.
 */
export function toolKind(name: string): ToolKind {
  return SCREENPLAY_TOOLS[name]?.kind ?? "other"
}

/** The name and input of a call, unwrapping Codex's `mcp.<server>.<tool>`. */
export function callIdentity(call: ToolCallMessage): {
  name: string
  input: Input
} {
  const name = bareToolName(call.title)
  // codex-acp 2 wraps an MCP call's input as `{ server, tool, arguments }`.
  const input = /^mcp\./.test(call.title)
    ? record(record(call.rawInput).arguments)
    : record(call.rawInput)
  return { name, input }
}

function resultText(call: ToolCallMessage): string {
  return call.content
    .map((b) =>
      b.type === "content" && b.content.type === "text" ? b.content.text : ""
    )
    .join("")
}

/** A file path across engines (`path`, `file_path`, …); null when none. */
function pathOf(input: Input): string | null {
  for (const key of ["path", "file_path", "filePath", "abs_path", "absPath"]) {
    const v = input[key]
    if (typeof v === "string" && v) return v
  }
  return null
}

/** The call's file path, falling back to the path on a diff it produced. */
function callPath(call: ToolCallMessage, input: Input): string | null {
  const path = pathOf(input)
  if (path) return path
  for (const block of call.content) if (block.type === "diff") return block.path
  return null
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

function host(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`
  } catch {
    return url
  }
}

/**
 * How many file lines a read returned, counted from the gutter-numbered
 * result: the in-process engine numbers lines `<n>\t…`, claude-agent-acp
 * `<n>→…`. Null when there are none (still running, an empty file).
 */
function readLineCount(call: ToolCallMessage): number | null {
  const text = call.content
    .map((b) =>
      b.type === "content" && b.content.type === "text" ? b.content.text : ""
    )
    .join("\n")
  const matches = text.match(/^[ \t]*\d+(?:\t|→)/gm)
  return matches ? matches.length : null
}

/** Whether a text block is only the call's own input, as a ```json block. */
export function echoesInput(text: string, rawInput: unknown): boolean {
  const fenced = text.trim().match(/^```json\n([\s\S]*)\n```$/)
  if (!fenced) return false
  try {
    return (
      JSON.stringify(JSON.parse(fenced[1]!)) ===
      JSON.stringify(rawInput ?? null)
    )
  } catch {
    return false
  }
}

type Harness = { label: RowLabel; icon?: ToolIcon; quiet?: true }

/** Codex's prose titles, read back into verb + subject. */
function codexProse(title: string): Harness | null {
  let m = title.match(/^Read file '(.+)'$/)
  if (m) return { label: { verb: "Read", detail: m[1], as: "code" } }
  m = title.match(/^Search for '(.+?)'(?: in (.+))?$/)
  if (m)
    return {
      label: { verb: "Search", detail: m[1], as: "code" },
      icon: "search",
    }
  m = title.match(/^List files in '(.+)'$/)
  if (m)
    return {
      label: { verb: "List files", detail: m[1], as: "code" },
      icon: "folder",
    }
  m = title.match(/^Web search: (.+)$/)
  if (m)
    return {
      label: { verb: "Search the web", detail: m[1], as: "text" },
      icon: "globe",
    }
  m = title.match(/^Open page: (.+)$/)
  if (m)
    return {
      label: { verb: "Open", detail: host(m[1]!), as: "code" },
      icon: "globe",
    }
  m = title.match(/^View Image (.+)$/)
  if (m)
    return {
      label: {
        verb: "Look at image",
        detail: m[1]!.split("/").at(-1),
        as: "code",
      },
      icon: "eye",
    }
  m = title.match(/^Start subagent (.+)$/)
  if (m)
    return {
      label: { verb: "Start subagent", detail: m[1], as: "text" },
      icon: "robot",
    }
  if (/^mcp__[^_]+(?:_[^_]+)*__startup$/.test(title)) {
    return {
      label: { verb: "Screenplay’s tools didn’t start" },
      icon: "warning",
    }
  }
  return null
}

/** Claude Code's built-in tools, by the title claude-agent-acp gives them. */
function claudeCodeBuiltIn(
  call: ToolCallMessage,
  input: Input
): Harness | null {
  const t = call.title
  if (t === "Skill")
    return {
      label: {
        verb: "Read skill",
        detail: str(input.skill) ?? undefined,
        as: "code",
      },
      icon: "skill",
      quiet: true,
    }
  if (call.kind === "search" && t.startsWith("grep")) {
    return {
      label: {
        verb: "Search",
        detail: str(input.pattern) ?? undefined,
        as: "code",
      },
      icon: "search",
    }
  }
  if (call.kind === "search" && t.startsWith("Find")) {
    return {
      label: {
        verb: "Find files",
        detail: str(input.pattern) ?? undefined,
        as: "code",
      },
      icon: "folder",
    }
  }
  if (call.kind === "fetch" && str(input.url)) {
    return {
      label: { verb: "Fetch", detail: host(str(input.url)!), as: "code" },
      icon: "globe",
    }
  }
  if (call.kind === "fetch" && str(input.query)) {
    return {
      label: { verb: "Search the web", detail: str(input.query)!, as: "text" },
      icon: "globe",
    }
  }
  if (t === "NotebookEdit") {
    const p = str(input.notebook_path)
    return {
      label: {
        verb: "Edit notebook",
        detail: p ? relativePath(p, t) : undefined,
        as: "code",
      },
      icon: "edit",
    }
  }
  // Its Write reads like our write_file.
  if (call.kind === "edit" && /^Write\b/.test(t) && pathOf(input)) {
    return {
      label: {
        verb: "Write",
        detail: relativePath(pathOf(input)!, t),
        as: "code",
      },
      icon: "file",
    }
  }
  return null
}

/**
 * OpenCode's built-in tools whose titles `opencode acp` rewrites as they run
 * (#1589): its skill tool ends titled "Loaded skill: <name>".
 */
function opencodeBuiltIn(call: ToolCallMessage, input: Input): Harness | null {
  const skill = call.title.match(/^Loaded skill: (.+)$/)?.[1]
  if (skill || (call.title === "skill" && str(input.name))) {
    return {
      label: {
        verb: "Read skill",
        detail: skill ?? str(input.name)!,
        as: "code",
      },
      icon: "skill",
      quiet: true,
    }
  }
  return null
}

/** The shell wrapper codex-acp's raw command carries (`/bin/zsh -lc '…'`). */
const SHELL_WRAPPER = /^(?:\/bin\/)?(?:bash|zsh|sh)\s+-/

/**
 * A harness tool nothing above knows, read by its ACP kind: a read, edit or
 * command with something to name reads like ours; anything else keeps its
 * own title.
 */
function byKind(call: ToolCallMessage, input: Input): RowLabel {
  const command = commandOf(input)
  const path =
    pathOf(input) ??
    (call.kind === "edit"
      ? (call.content.find((b) => b.type === "diff")?.path ?? null)
      : null)
  if (call.kind === "execute" && command) {
    // Codex's title is the command without its shell wrapper.
    const detail = SHELL_WRAPPER.test(command) ? call.title : command
    return { verb: "Run command", detail, as: "code" }
  }
  if ((call.kind === "read" || call.kind === "edit") && path) {
    return {
      verb: call.kind === "read" ? "Read" : "Edit",
      detail: relativePath(path, call.title),
      as: "code",
    }
  }
  // OpenCode titles a finished search with its bare pattern (#1589).
  const pattern = str(input.pattern)
  if (call.kind === "search" && pattern) {
    return { verb: "Search", detail: pattern, as: "code" }
  }
  // A harness's PascalCase tool name as words: `NotebookRead` → "Notebook read".
  if (/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(call.title)) {
    return {
      verb: call.title
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/ ([A-Z])/g, (_, c: string) => ` ${c.toLowerCase()}`),
    }
  }
  return { verb: call.title, title: true }
}

/** Icons for a harness tool's ACP kind, when its label names none. */
const KIND_ICON: Partial<Record<ToolKind, ToolIcon>> = {
  read: "file",
  search: "search",
  edit: "edit",
  execute: "terminal",
  fetch: "fetch",
  think: "think",
}

/** Summary categories for a harness tool's ACP kind. */
const KIND_CATEGORY: Partial<Record<ToolKind, SummaryCategory>> = {
  read: "read",
  edit: "edit",
  delete: "edit",
  move: "edit",
  execute: "run",
  search: "search",
}

/** What a failed call of each category is called in a summary's chip. */
const FAILURE_NAME: Record<SummaryCategory, string> = {
  read: "Read",
  readDoc: "Read",
  edit: "Edit",
  editDoc: "Edit",
  run: "Command",
  search: "Search",
  canvas: "Canvas change",
  readCanvas: "Read canvas",
  readWorkspace: "Chat read",
  viewFrame: "View frame",
  listChanges: "List changes",
  memory: "Save to memory",
  view: "Show on canvas",
  drive: "Frame step",
}

// A raw snake_case tool identifier (`read_file`): one of ours this table
// doesn't know yet, or another MCP server's. An adapter's prose title
// ("Read `file.ts`") is never re-cased.
const RAW_TOOL_NAME = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/

/**
 * What a finished canvas change, PR or removal did, from its result's first
 * line (the lines after it are ids for the model), without the closing
 * period. Null while it runs, and for a result that reports an error.
 */
function outcomeLine(call: ToolCallMessage): string | null {
  if (call.status !== "completed") return null
  const line = resultText(call).split("\n")[0]!.trim()
  if (!line || line.startsWith("Error:")) return null
  return line.replace(/\.$/, "")
}

/** Whether every text the call returned only restates a gesture. */
function restatesGesture(call: ToolCallMessage): boolean {
  return call.content.every(
    (b) =>
      b.type === "terminal" ||
      (b.type === "content" &&
        b.content.type === "text" &&
        (/^(Did |Started|Stopped)/.test(b.content.text) ||
          echoesInput(b.content.text, call.rawInput)))
  )
}

/**
 * Describe one tool call, from any engine: the in-process engine's bare
 * names, a harness's namespaced calls to the same tools, and a harness's own
 * built-in tools. A Workspace a Coordinator tool names reads by its title,
 * when `workspaceTitle` knows it.
 */
export function describeToolCall(
  call: ToolCallMessage,
  ctx: Context = {}
): ToolDescription {
  const { name, input } = callIdentity(call)
  const entry = Object.hasOwn(SCREENPLAY_TOOLS, name)
    ? SCREENPLAY_TOOLS[name]
    : undefined
  const path = callPath(call, input)

  let label: RowLabel
  let icon: ToolIcon
  let output: ToolOutput = "plain"
  let quiet = false
  let category: SummaryCategory | null
  let readPath: string | null = null

  if (entry) {
    const own = entry.label ? entry.label(input, resultText(call), ctx) : null
    const fallback: Partial<RowLabel> =
      entry.label || !pathOf(input)
        ? {}
        : { detail: pathOf(input)!, as: "code" }
    label = { verb: entry.verb, ...(own ?? fallback) }
    icon = entry.icon
    category = entry.category ?? null
    if (entry.fileRead) readPath = pathOf(input)
    const outcome = entry.output === "outcome" ? outcomeLine(call) : null
    if (outcome) {
      label = { verb: outcome }
      quiet = true
    }
    if (entry.output === "quiet") quiet = true
    else if (entry.output && entry.output !== "outcome") output = entry.output
    if (entry.gesture && restatesGesture(call)) quiet = true
  } else {
    const known =
      codexProse(call.title) ??
      claudeCodeBuiltIn(call, input) ??
      opencodeBuiltIn(call, input)
    if (known) {
      label = known.label
      quiet = !!known.quiet
    } else if (RAW_TOOL_NAME.test(name)) {
      // Sentence case, not Title Case: `search_files` → "Search files".
      const spaced = name.replace(/_/g, " ")
      label = { verb: spaced.charAt(0).toUpperCase() + spaced.slice(1) }
      if (pathOf(input))
        label = { ...label, detail: pathOf(input)!, as: "code" }
    } else {
      label = byKind(call, input)
    }
    icon =
      known?.icon ??
      (call.kind ? KIND_ICON[call.kind] : undefined) ??
      "terminal"
    output =
      call.kind === "fetch"
        ? "markdown"
        : call.kind === "execute"
          ? "log"
          : "plain"
    if (call.kind === "read") {
      readPath =
        pathOf(input) ?? call.title.match(/^Read file '(.+)'$/)?.[1] ?? null
    }
    const byKindCategory = call.kind ? (KIND_CATEGORY[call.kind] ?? null) : null
    // A read with no file (a skill, a directory listing) isn't "read a file".
    category = byKindCategory === "read" && !path ? null : byKindCategory
  }

  // A file read leads with the lines it returned ("Read 42 lines").
  if (readPath && !label.title) {
    const lines = readLineCount(call)
    if (lines != null) {
      label = {
        ...label,
        verb: `${label.verb} ${lines} ${lines === 1 ? "line" : "lines"}`,
      }
    }
  }

  const driveStep = name.startsWith("frame_") && name !== "frame_open"
  const frameId = str(input.frameId) ?? ""

  let failure = category ? FAILURE_NAME[category] : "A step"
  if (category === "run") {
    const line = commandOf(input) ?? (entry ? "" : call.title.replace(/`/g, ""))
    const words = line.split(/\s+/).filter(Boolean)
    if (words.length > 0) failure = words.slice(0, 2).join(" ")
  }

  // Repeat reads or edits of one file, or reads of one Workspace or frame,
  // count once.
  const summaryKey =
    category === "read" || category === "edit"
      ? path
      : category === "readWorkspace"
        ? str(input.workspaceId)
        : category === "viewFrame" || category === "drive"
          ? (str(input.frameId) ??
            // A Frame Drive call with no frameId acts on the chat's own frame.
            (name.startsWith("frame_") ? "own frame" : null))
          : null

  return {
    name,
    label,
    icon,
    output,
    quiet,
    readPath,
    rewrite: name.startsWith("frame_")
      ? "frame-names"
      : name === "run_command"
        ? "command-output"
        : null,
    category,
    summaryKey,
    failure,
    driveStep,
    gesture: !!entry?.gesture,
    frameId,
  }
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
export function driveName(calls: ToolCallMessage[]): string | null {
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
