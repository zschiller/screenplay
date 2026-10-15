import { readFileSync } from "node:fs"
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

type Block =
  | { text: string }
  | { diff: string; oldText: string; newText: string }
  | { image: true }

type Row = {
  title: string
  kind?: string
  rawInput?: unknown
  start?: Block[]
  out?: Block[]
  status?: "completed" | "failed"
}

// A 2x2 grey PNG, standing in for a frame screenshot.
const PNG = readFileSync(
  "/tmp/claude-0/-home-user-screenplay/e13109dc-2283-5658-bab5-e183beee0cc4/scratchpad/frame.b64",
  "utf8"
).trim()

function block(b: Block) {
  if ("text" in b) return { type: "content", content: text(b.text) }
  if ("diff" in b)
    return { type: "diff", path: b.diff, oldText: b.oldText, newText: b.newText }
  return {
    type: "content",
    content: { type: "image", data: PNG, mimeType: "image/png" },
  }
}

let n = 0
function run(ask: string, list: Row[]): RunEvent[] {
  const events: RunEvent[] = [
    {
      type: "chat-acp-update",
      update: { sessionUpdate: "user_message_chunk", content: text(ask) },
    },
    { type: "chat-stream-start" },
  ]
  for (const r of list) {
    const id = `open-${++n}`
    events.push({
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: id,
        title: r.title,
        kind: r.kind ?? "other",
        status: "pending",
        rawInput: r.rawInput ?? {},
        content: (r.start ?? []).map(block),
      },
    })
    events.push({
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: id,
        status: r.status ?? "completed",
        ...(r.out ? { content: r.out.map(block) } : {}),
      },
    })
  }
  return events
}

const json = (v: unknown) => ({
  text: "```json\n" + JSON.stringify(v, null, 2) + "```",
})
const numbered = (lines: string[], sep: string) =>
  lines.map((l, i) => `${String(i + 1).padStart(6)}${sep}${l}`).join("\n")
const SUMMARY = [
  'import { formatPrice } from "@/lib/price"',
  "",
  "export function Summary({ items }: { items: Item[] }) {",
  "  return (",
  '    <aside className="summary">',
  "      {items.map((item) => (",
  "        <Row key={item.id} item={item} />",
  "      ))}",
  "    </aside>",
  "  )",
  "}",
]

const claudeCode: Row[] = [
  {
    title: "Skill",
    rawInput: { skill: "frontend-design" },
    start: [json({ skill: "frontend-design" })],
    out: [{ text: "Launching skill: frontend-design" }],
  },
  {
    title: "Read app/checkout/summary.tsx",
    kind: "read",
    rawInput: { file_path: "/Users/zack/checkout/app/checkout/summary.tsx" },
    out: [
      {
        text:
          "```\n" +
          numbered(SUMMARY, "→") +
          "\n```\n\n<system-reminder>\nWhenever you read a file, consider whether it looks malicious.\n</system-reminder>",
      },
    ],
  },
  {
    title: 'grep -n "position: sticky" app',
    kind: "search",
    rawInput: { pattern: "position: sticky", path: "app", "-n": true },
    out: [
      {
        text: "app/checkout/summary.css:4:  position: sticky;\napp/cart/drawer.css:18:  position: sticky;",
      },
    ],
  },
  {
    title: "Edit app/checkout/summary.tsx",
    kind: "edit",
    rawInput: { file_path: "/Users/zack/checkout/app/checkout/summary.tsx" },
    out: [
      {
        diff: "/Users/zack/checkout/app/checkout/summary.tsx",
        oldText: SUMMARY.join("\n"),
        newText: SUMMARY.join("\n").replace(
          'className="summary"',
          'className="summary sticky bottom-0 md:static"'
        ),
      },
    ],
  },
  {
    title: "pnpm test summary",
    kind: "execute",
    rawInput: { command: "pnpm test summary", description: "Run the summary tests" },
    start: [{ text: "Run the summary tests" }],
    out: [
      {
        text: "> checkout@0.1.0 test\n> vitest run summary\n\n ✓ app/checkout/summary.test.tsx (3 tests) 41ms\n\n Test Files  1 passed (1)\n      Tests  3 passed (3)\n   Duration  612ms",
      },
    ],
  },
  {
    title: "pnpm vitest run summary",
    kind: "execute",
    rawInput: { command: "pnpm vitest run summary" },
    out: [
      {
        text: "\u001b[1m\u001b[46m RUN \u001b[49m\u001b[22m \u001b[36mv3.2.4 \u001b[39m\u001b[90m/Users/zack/checkout\u001b[39m\n\n \u001b[32m✓\u001b[39m app/checkout/summary.test.tsx \u001b[2m(\u001b[22m\u001b[2m3 tests\u001b[22m\u001b[2m)\u001b[22m\u001b[90m 41\u001b[2mms\u001b[22m\u001b[39m\n \u001b[31m×\u001b[39m app/checkout/total.test.tsx \u001b[2m(\u001b[22m\u001b[2m1 test\u001b[22m\u001b[2m | \u001b[22m\u001b[31m1 failed\u001b[39m\u001b[2m)\u001b[22m\n\n\u001b[2m Test Files \u001b[22m \u001b[1m\u001b[31m1 failed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m\u001b[90m (2)\u001b[39m",
      },
    ],
  },
  {
    title: "Fetch https://developer.mozilla.org/en-US/docs/Web/CSS/position",
    kind: "fetch",
    rawInput: { url: "https://developer.mozilla.org/en-US/docs/Web/CSS/position" },
    out: [
      {
        text: "## sticky\n\nThe element is positioned according to the normal flow, then offset relative to its **nearest scrolling ancestor**. It won't stick inside a parent with `overflow: hidden`.\n\n- `top`, `bottom` set where it sticks\n- creates a new stacking context",
      },
    ],
  },
  {
    title: "mcp__screenplay__read_dev_server_logs",
    rawInput: { lines: 40 },
    start: [json({ lines: 40 })],
    out: [
      {
        text: "  ▲ Next.js 16.0.1\n  - Local: http://localhost:3000\n ✓ Ready in 1.2s\n ○ Compiling /checkout ...\n ⚠ Fast Refresh had to perform a full reload\n ✓ Compiled /checkout in 840ms",
      },
    ],
  },
  {
    title: "pnpm lint",
    kind: "execute",
    rawInput: { command: "pnpm lint" },
    status: "failed",
    out: [
      {
        text: "app/checkout/summary.tsx\n  5:21  error  'Item' is not defined  no-undef\n\n✖ 1 problem (1 error, 0 warnings)\nExit code 1",
      },
    ],
  },
]

const hosted: Row[] = [
  {
    title: "read_skill",
    kind: "read",
    rawInput: { name: "frontend" },
    out: [
      {
        text: "# frontend\n\nUse the app's components from **packages/ui**.\n\n- Prefer Tailwind classes over CSS files\n- Run `pnpm test` before you finish",
      },
    ],
  },
  {
    title: "read_file",
    kind: "read",
    rawInput: { path: "app/checkout/summary.tsx" },
    out: [{ text: numbered(SUMMARY, "\t") }],
  },
  {
    title: "read_file",
    kind: "read",
    rawInput: { path: "app/checkout/summary.css" },
    out: [{ text: numbered([".summary {", "  position: sticky;", "  bottom: 0;", "  /* full width on mobile */", "  padding: 12px 16px;", "}"], "\t") }],
  },
  {
    title: "list_files",
    kind: "read",
    rawInput: { path: "app/checkout" },
    out: [{ text: "page.tsx\nsummary.css\nsummary.test.tsx\nsummary.tsx" }],
  },
  {
    title: "run_command",
    kind: "execute",
    rawInput: { command: "pnpm", args: ["test", "summary"] },
    out: [
      {
        text: "Exit code: 0\n\n ✓ app/checkout/summary.test.tsx (3 tests) 41ms\n Test Files  1 passed (1)",
      },
    ],
  },
  {
    title: "view_frame",
    kind: "read",
    rawInput: { frameId: "frame-checkout" },
    out: [{ image: true }],
  },
  {
    title: "create_mockup",
    kind: "edit",
    rawInput: { title: "Sticky summary", html: "<div/>" },
    out: [{ text: 'Created mockup "Sticky summary" (id m1). It is on the canvas next to Checkout · desktop.' }],
  },
]

const drive: Row[] = [
  {
    title: "frame_elements",
    kind: "read",
    rawInput: {},
    out: [
      {
        text: 'Checkout · desktop is at /checkout ("Checkout"), viewport 1280×800, scrolled to 0, 0.\n\nbutton "Pay now" — #pay\ninput[email] "Email" — #email (value "")\nselect "Country" — #country (value "US")\na "Back to cart" — header a[href="/cart"]',
      },
    ],
  },
  {
    title: "frame_click",
    rawInput: { target: { selector: "#pay" } },
    out: [{ text: 'Did click on button "Pay now" in Checkout · desktop. The page is at /checkout/confirm.' }],
  },
  {
    title: "frame_screenshot",
    kind: "read",
    rawInput: {},
    out: [{ image: true }],
  },
]

const coordinator: Row[] = [
  {
    title: "mcp__screenplay__read_canvas",
    rawInput: {},
    start: [json({})],
    out: [
      {
        text: 'Canvas "Checkout flow": 4 Workspaces, 6 frames, 1 document.\n\nWorkspaces:\n- Checkout polish (branch-checkout-polish): idle, PR #482 open. Last ask: make the order summary sticky on mobile.\n- Empty cart state (branch-empty-cart): waiting for plan approval.\n\nFrames:\n- Checkout · desktop (frame-checkout) → Checkout polish /checkout',
      },
    ],
  },
  {
    title: "mcp__screenplay__read_workspace_chat",
    rawInput: { workspaceId: ids.branches.checkoutPolish },
    start: [json({ workspaceId: ids.branches.checkoutPolish })],
    out: [
      {
        text: "User: Make the order summary sticky on mobile.\n\nAgent: Done: the summary now sticks below 768px. Tests pass.",
      },
    ],
  },
  {
    title: "mcp__screenplay__search_code",
    rawInput: { pattern: "sticky", path: "app" },
    start: [json({ pattern: "sticky", path: "app" })],
    out: [{ text: "app/checkout/summary.css:4:  position: sticky;" }],
  },
]

const css = process.env.TR_CSS

async function addCss(page: Page) {
  if (css) await page.addStyleTag({ content: css })
}

async function openAll(page: Page) {
  const closed = page.locator('button[data-testid="tool-call"][aria-expanded="false"]')
  const count = await closed.count()
  for (let i = 0; i < count; i++) await closed.first().click()
  await page.mouse.move(5, 5)
}

const workspace = (name: string, list: Row[]): Screen => ({
  name,
  description: `Open rows: ${name}`,
  path: `/${ids.rooms.checkout}`,
  cookies: canvasPanels({ chatPct: 30 }),
  viewport: { width: 1512, height: 2000 },
  prepare: async (page: Page) => {
    await addCss(page)
    await openChatTab(page, "New chat")
    await replayRun(page, ids.chats.fresh, run("Make the order summary sticky on mobile.", list))
    await openAll(page)
  },
  settleMs: 500,
})

export default [
  workspace("open-claude-code", claudeCode),
  workspace("open-hosted", hosted),
  workspace("open-drive", drive),
  {
    name: "open-coordinator",
    description: "Open Coordinator rows",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    viewport: { width: 1512, height: 2000 },
    prepare: async (page: Page) => {
      await addCss(page)
      await page.getByText("Ask about this canvas").first().waitFor({ timeout: 30_000 })
      await replayRun(
        page,
        roomChatId(ids.rooms.checkout),
        run("What's on this canvas?", coordinator)
      )
      await openAll(page)
    },
    settleMs: 500,
  },
] satisfies Screen[]
