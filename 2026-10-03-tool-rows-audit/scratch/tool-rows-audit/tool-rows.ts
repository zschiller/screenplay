import type { Page } from "playwright-core"

import { roomChatId } from "@/lib/chat/room-chat"
import {
  canvasPanels,
  ids,
  openChatTab,
  replayRun,
  text,
  type RunEvent,
} from "../helpers"
import type { Screen } from "../screen"

type Row = {
  title: string
  kind?: string
  rawInput?: unknown
  result?: string
  diff?: string
  status?: "completed" | "failed" | "in_progress"
}

let n = 0
function rows(ask: string, list: Row[], finished = false): RunEvent[] {
  const events: RunEvent[] = [
    {
      type: "chat-acp-update",
      update: { sessionUpdate: "user_message_chunk", content: text(ask) },
    },
    { type: "chat-stream-start" },
  ]
  for (const r of list) {
    const id = `audit-${++n}`
    events.push({
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: id,
        title: r.title,
        kind: r.kind ?? "other",
        status: "pending",
        rawInput: r.rawInput ?? {},
      },
    })
    if (r.status === "in_progress") continue
    events.push({
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status: r.status ?? "completed",
        content: r.diff
          ? [{ type: "diff", path: r.diff, oldText: "a\n", newText: "b\n" }]
          : r.result
            ? [{ type: "content", content: text(r.result) }]
            : [],
      },
    })
  }
  if (finished) {
    events.push(
      {
        type: "chat-acp-update",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: text("Done: the summary now sticks below 768px."),
        },
      },
      { type: "chat-stream-end" }
    )
  }
  return events
}

const numbered = (lines: string[], sep = "\t") =>
  lines.map((l, i) => `${i + 1}${sep}${l}`).join("\n")

const sel = "main > section:nth-of-type(2) > form > button.btn-primary"

/** The hosted built-in agent in a Workspace chat. */
const hostedWorkspace: Row[] = [
  { title: "read_skill", kind: "read", rawInput: { name: "frontend" } },
  {
    title: "list_files",
    kind: "read",
    rawInput: { path: "app/checkout" },
    result: "page.tsx\nsummary.tsx",
  },
  {
    title: "grep",
    kind: "search",
    rawInput: { pattern: "position: sticky", path: "app" },
    result: "app/checkout/summary.tsx:12",
  },
  {
    title: "glob",
    kind: "search",
    rawInput: { pattern: "**/*.css" },
    result: "app/globals.css",
  },
  {
    title: "read_file",
    kind: "read",
    rawInput: { path: "app/checkout/summary.tsx" },
    result: numbered(["export function Summary() {", "  return null", "}"]),
  },
  {
    title: "edit_file",
    kind: "edit",
    rawInput: {
      path: "app/checkout/summary.tsx",
      old_string: "a",
      new_string: "b",
    },
  },
  {
    title: "write_file",
    kind: "edit",
    rawInput: { path: "app/checkout/sticky.css", content: "" },
  },
  {
    title: "run_command",
    kind: "execute",
    rawInput: { command: "pnpm", args: ["test", "summary"] },
    result: "1 passed",
  },
  { title: "read_dev_server_logs", kind: "read", rawInput: {} },
  { title: "restart_dev_server", kind: "execute", rawInput: {} },
  {
    title: "view_frame",
    kind: "read",
    rawInput: { frameId: "frame-checkout" },
  },
  { title: "read_frame_html", kind: "read", rawInput: {} },
  {
    title: "create_mockup",
    kind: "edit",
    rawInput: { title: "Sticky summary", html: "<div/>" },
  },
  { title: "read_mockup", kind: "read", rawInput: { mockup_id: "m1" } },
  { title: "update_mockup", kind: "edit", rawInput: { mockup_id: "m1" } },
  { title: "create_pr", kind: "execute", rawInput: { title: "Sticky" } },
  {
    title: "run_command",
    kind: "execute",
    rawInput: { command: "pnpm", args: ["lint"] },
    status: "in_progress",
  },
]

/** Frame Drive, hosted (bare names) then the Mac over MCP. */
const drive: Row[] = [
  {
    title: "frame_start_driving",
    rawInput: { frameId: "frame-checkout", pace: "show" },
  },
  { title: "frame_open", rawInput: { route: "/checkout" } },
  { title: "frame_elements", kind: "read", rawInput: {} },
  { title: "frame_click", rawInput: { target: { selector: sel } } },
  {
    title: "frame_click",
    rawInput: { target: { selector: sel } },
    result: 'Did click on button "Pay" in Checkout · desktop. The page is at /checkout.',
  },
  { title: "frame_click", rawInput: { target: { text: "Pay now" } } },
  { title: "frame_click", rawInput: { target: { x: 412.4, y: 300.2 } } },
  {
    title: "frame_type",
    rawInput: { target: { selector: "#email" }, text: "ada@example.com" },
  },
  { title: "frame_key", rawInput: { key: "Enter", modifiers: {} } },
  { title: "frame_key", rawInput: { key: "k", modifiers: { metaKey: true } } },
  { title: "frame_scroll", rawInput: { dy: 400 } },
  {
    title: "frame_select",
    rawInput: { target: { selector: "#country" }, value: "GB" },
  },
  {
    title: "frame_drag",
    rawInput: {
      target: { selector: "li:nth-child(1)" },
      to: { selector: "li:nth-child(3)" },
    },
  },
  { title: "frame_screenshot", kind: "read", rawInput: {} },
  { title: "frame_stop_driving", rawInput: {} },
  {
    title: "mcp__screenplay__frame_click",
    rawInput: { target: { selector: "[data-testid=pay]" } },
  },
  {
    title: "mcp.screenplay.frame_click",
    kind: "execute",
    rawInput: {
      server: "screenplay",
      tool: "frame_click",
      arguments: { target: { text: "Pay now" } },
    },
  },
]

/** A Workspace chat on Claude Code (desktop), as claude-agent-acp 0.54.1 titles it. */
const claudeCode: Row[] = [
  {
    title: "ToolSearch",
    rawInput: { query: "select:mcp__screenplay__read_dev_server_logs" },
    result: "```json\n{}```",
  },
  {
    title: "Skill",
    rawInput: { skill: "frontend-design" },
    result: "Launching skill: frontend-design",
  },
  {
    title: "Read app/checkout/summary.tsx",
    kind: "read",
    rawInput: { file_path: "/Users/zack/checkout/app/checkout/summary.tsx" },
    result: numbered(["export function Summary() {", "}"], "→"),
  },
  {
    title: 'grep -n "position: sticky" app',
    kind: "search",
    rawInput: { pattern: "position: sticky", path: "app", "-n": true },
  },
  {
    title: "Find `app` `**/*.css`",
    kind: "search",
    rawInput: { pattern: "**/*.css", path: "app" },
  },
  {
    title: "Edit app/checkout/summary.tsx",
    kind: "edit",
    rawInput: { file_path: "/Users/zack/checkout/app/checkout/summary.tsx" },
  },
  {
    title: "pnpm test summary",
    kind: "execute",
    rawInput: { command: "pnpm test summary", description: "Run tests" },
  },
  {
    title: "Fetch https://developer.mozilla.org/en-US/docs/Web/CSS/position",
    kind: "fetch",
    rawInput: { url: "https://developer.mozilla.org/en-US/docs/Web/CSS/position" },
  },
  {
    title: '"css sticky inside overflow hidden"',
    kind: "fetch",
    rawInput: { query: "css sticky inside overflow hidden" },
  },
  {
    title: "mcp__screenplay__read_dev_server_logs",
    rawInput: {},
    result: "ready on :3000",
  },
  {
    title: "mcp__screenplay__restart_dev_server",
    rawInput: {},
  },
  { title: "NotebookEdit", rawInput: { notebook_path: "x.ipynb" } },
  { title: "Ready to code?", kind: "switch_mode", rawInput: {} },
]

/** A Workspace chat on Codex (desktop), as codex-acp 2.0.1 titles it. */
const codex: Row[] = [
  {
    title: "Read file 'app/checkout/summary.tsx'",
    kind: "read",
    rawInput: {},
  },
  {
    title: "Search for 'position: sticky' in app",
    kind: "search",
    rawInput: {},
  },
  { title: "List files in 'app/checkout'", kind: "read", rawInput: {} },
  {
    title: "pnpm test summary",
    kind: "execute",
    rawInput: { command: "/bin/zsh -lc 'pnpm test summary'", cwd: "/Users/zack/checkout" },
  },
  {
    title: "Editing files",
    kind: "edit",
    rawInput: {},
    diff: "/Users/zack/checkout/app/checkout/summary.tsx",
  },
  {
    title: "Web search: css sticky inside overflow hidden",
    kind: "search",
    rawInput: { query: "css sticky inside overflow hidden" },
  },
  {
    title: "mcp.screenplay.read_dev_server_logs",
    kind: "execute",
    rawInput: { server: "screenplay", tool: "read_dev_server_logs", arguments: {} },
  },
  {
    title: "View Image /var/folders/x/T/screenshot-1.png",
    kind: "read",
    rawInput: {},
  },
  { title: "Start subagent explorer", rawInput: {} },
  { title: "Compact conversation", kind: "think", rawInput: {} },
  {
    title: "mcp__screenplay__startup",
    status: "failed",
    result: "MCP server screenplay failed to start: connection refused",
  },
]

/** The Coordinator on Claude Code: its own tools over MCP. */
const coordinator: Row[] = [
  { title: "ToolSearch", rawInput: { query: "select:mcp__screenplay__read_canvas" } },
  { title: "mcp__screenplay__read_skill", rawInput: { name: "coordinator" } },
  { title: "mcp__screenplay__read_canvas", rawInput: {} },
  { title: "mcp__screenplay__list_changes", rawInput: {} },
  {
    title: "mcp__screenplay__read_workspace_chat",
    rawInput: { workspaceId: ids.branches.checkoutPolish },
  },
  {
    title: "mcp__screenplay__read_workspace_diff",
    rawInput: { workspaceId: ids.branches.checkoutPolish },
  },
  {
    title: "mcp__screenplay__read_code_file",
    rawInput: { path: "app/checkout/summary.tsx" },
  },
  {
    title: "mcp__screenplay__search_code",
    rawInput: { pattern: "sticky", path: "app" },
  },
  {
    title: "mcp__screenplay__find_code_files",
    rawInput: { pattern: "**/*.css" },
  },
  { title: "mcp__screenplay__read_document", rawInput: { id: "doc-1" } },
  { title: "mcp__screenplay__view_frame", rawInput: { frameId: "f" } },
  {
    title: "mcp__screenplay__write_memory",
    rawInput: { content: "Zack prefers…" },
  },
  {
    title: "mcp__screenplay__start_chat",
    rawInput: { title: "Pricing page sketch", prompt: "Explore" },
  },
  {
    title: "mcp__screenplay__send_to_chat",
    rawInput: { chatId: "x", message: "Also mobile" },
  },
  {
    title: "mcp__screenplay__stop_workspace",
    rawInput: { workspace_id: ids.branches.emptyCart },
  },
  {
    title: "mcp__screenplay__show_on_canvas",
    rawInput: { id: "x" },
    result: 'Showed frame "Checkout".',
  },
  {
    title: "mcp.screenplay.read_canvas",
    kind: "execute",
    rawInput: { server: "screenplay", tool: "read_canvas", arguments: {} },
  },
]

const workspace = (name: string, description: string, list: Row[], finished = false): Screen => ({
  name,
  description,
  path: `/${ids.rooms.checkout}`,
  cookies: canvasPanels({ chatPct: 30 }),
  viewport: { width: 1512, height: 1300 },
  prepare: async (page: Page) => {
    if (process.env.TR_CSS) await page.addStyleTag({ content: process.env.TR_CSS })
    await openChatTab(page, "New chat")
    await replayRun(page, ids.chats.fresh, rows("Make the order summary sticky on mobile.", list, finished))
    if (finished) await page.getByTestId("turn-summary-trigger").first().click()
  },
  settleMs: 500,
})

export default [
  workspace("audit-tools-hosted", "Hosted built-in agent rows", hostedWorkspace),
  workspace("audit-tools-drive", "Frame Drive rows", drive),
  workspace("audit-tools-claude-code", "Claude Code harness rows", claudeCode),
  workspace("audit-tools-codex", "Codex harness rows", codex),
  workspace("audit-tools-summary", "A folded turn's summary", claudeCode.slice(0, 7), true),
  {
    name: "audit-tools-coordinator",
    description: "Coordinator on Claude Code",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    viewport: { width: 1512, height: 1300 },
    prepare: async (page: Page) => {
      if (process.env.TR_CSS) await page.addStyleTag({ content: process.env.TR_CSS })
      await page.getByText("Ask about this canvas").first().waitFor({ timeout: 30_000 })
      await replayRun(
        page,
        roomChatId(ids.rooms.checkout),
        rows("What's on this canvas, and which Workspaces are behind?", coordinator)
      )
    },
    settleMs: 500,
  },
] satisfies Screen[]
