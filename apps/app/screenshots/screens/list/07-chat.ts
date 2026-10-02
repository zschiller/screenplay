import type { Page } from "playwright-core"

import type { Screen } from "../screen"
import {
  canvasPanels,
  ids,
  openChatTab,
  typeInComposer,
  type RunEvent,
  replayRun,
  text,
  stubSteer,
  questionRun,
  expandTurnSummaries,
  showTooltip,
} from "../helpers"

const screens: Screen[] = [
  {
    name: "canvas-chat-empty",
    description: "A frame chat with nothing sent yet: the empty state.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-off-default",
    description:
      "A new chat switched off the default model: the composer says so.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await page.getByRole("button", { name: /^Opus 5\.5/ }).click()
      await page.getByRole("menuitem", { name: "Sonnet 5.5" }).click()
      await page.getByText("· not default").waitFor()
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-loading",
    description: "A chat while its history is still loading.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      // History loads once, on mount, so hold the request open and reload.
      await page.route("**/api/agent/history**", () => {})
      await page.reload()
      await page.waitForTimeout(1500)
    },
  },
  {
    name: "canvas-chat-streaming",
    description: "A run mid-stream, with assistant text already arriving.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, streamingRun())
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-question",
    description:
      "A chat asking a question as a card: one button per option, the recommended one marked (#1312).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, questionRun())
      await page
        .getByTestId("question-card")
        .first()
        .waitFor({ timeout: 10_000 })
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-question-answered",
    description:
      "The same question card once answered: the chosen option ticked, every button disabled (#1312).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, [
        ...questionRun(),
        {
          type: "chat-acp-update",
          update: {
            sessionUpdate: "user_message_chunk",
            content: text("Pin to the bottom"),
          },
        },
      ])
      await page
        .getByTestId("question-card")
        .first()
        .waitFor({ timeout: 10_000 })
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-stopped",
    description: "A run the user stopped part-way through.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, [
        ...streamingRun(),
        { type: "chat-control", control: { kind: "stopped" } },
        { type: "chat-stream-end" },
      ])
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-stop-failed",
    description: "A run whose Stop request failed.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page.route("**/api/agent/stop", (route) =>
        route.fulfill({ status: 500, body: "The run didn't respond" })
      )
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, streamingRun())
      await page
        .locator('[title="Stop"], [aria-label="Stop"]')
        .first()
        .click({ timeout: 10_000 })
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-composer-draft",
    description: "A frame chat with a draft typed into the composer.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await typeInComposer(page, "Make the order summary sticky on mobile")
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-composer-selection",
    description:
      "A draft in a chat's composer with its text selected: the accent selection tint (#1033).",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await typeInComposer(page, "Make the order summary sticky on mobile")
      await page.keyboard.press("ControlOrMeta+A")
    },
    settleMs: 400,
  },
  {
    name: "composer-mention-list",
    description: "The composer's @ menu: the Canvas's Documents to mention.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await typeInComposer(page, "Match the tone in @")
      await page
        .getByText("Documents", { exact: true })
        .waitFor({ timeout: 10_000 })
    },
    settleMs: 400,
  },
  {
    name: "composer-skill-list",
    description: "The composer's / menu: the Skills the agent can run.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await typeInComposer(page, "/")
      await page
        .getByText("Skills", { exact: true })
        .waitFor({ timeout: 10_000 })
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-draft-reload",
    description:
      "A draft typed into a chat, after the page reloads: what's left in the composer.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await typeInComposer(page, "Make the order summary sticky on mobile")
      await page.waitForTimeout(300)
      await page.reload()
      await openChatTab(page, "New chat")
    },
    settleMs: 600,
  },
  {
    name: "canvas-chat-send-failed",
    description: "A message the server refused: what's left of it in the chat.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await page.route("**/api/agent/stream", (route) =>
        route.fulfill({ status: 503, body: "The agent couldn't be reached" })
      )
      await openChatTab(page, "New chat")
      await typeInComposer(page, "Make the order summary sticky on mobile")
      await page.keyboard.press("Enter")
    },
    settleMs: 600,
  },
  {
    name: "canvas-chat-history-failed",
    description:
      "A chat whose history didn't load: the failure with Retry, not the empty chat.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: async (page) => {
      await page.route("**/api/agent/history*", (route) =>
        route.fulfill({ status: 502, body: "" })
      )
    },
    settleMs: 600,
  },
  {
    name: "canvas-chat-models-failed",
    description:
      "A chat whose model list didn't load: the composer says so, with Retry.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: async (page) => {
      await page.route("**/api/agent/models", (route) =>
        route.fulfill({ status: 500, body: "" })
      )
    },
    settleMs: 600,
  },
  {
    name: "canvas-chat-no-agent",
    description:
      "A chat on a device with no coding agent: the composer points to Settings.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: async (page) => {
      await page.route("**/api/agent/models", (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ models: [], defaultModelId: null }),
        })
      )
    },
    settleMs: 600,
  },
  {
    name: "canvas-chat-queued",
    description:
      "A message sent with Enter while an agent that can't be steered is still running: the Queued row.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, [
        ...streamingRun(),
        {
          type: "chat-control",
          control: { kind: "steerable", steerable: false },
        },
      ])
      await typeInComposer(page, "Then do the same for the cart page")
      await page.keyboard.press("Enter")
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-steer-pending",
    description:
      "A message sent with Enter while the agent is running (#1190): it steers the turn, waiting at the end of the chat until the agent takes it.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await stubSteer(page, ids.chats.fresh)
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, streamingRun())
      await typeInComposer(page, "Then do the same for the cart page")
      await page.keyboard.press("Enter")
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-steer-draft",
    description:
      "A draft typed while the agent is running in a chat that can steer: the button reads Send.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, streamingRun())
      await typeInComposer(page, "Then do the same for the cart page")
      await page
        .locator('[aria-label="Send"]')
        .last()
        .hover({ timeout: 5_000 })
        .catch(() => {})
    },
    settleMs: 600,
  },
  {
    name: "canvas-chat-image-paste",
    description: "An image pasted into the composer.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await typeInComposer(page, "Match this layout ")
      await pasteImageInComposer(page)
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-tool-states",
    description:
      "Every tool-call state: running, done, failed with and without a reason, an expanded edit diff, and a long transcript error.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, toolStatesRun())
      await expandTurnSummaries(page)
      await expandToolCall(page, /^Edit/)
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-tool-hover",
    description:
      "A tool call whose path is too long for the row, hovered to read it in full.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, toolStatesRun())
      await expandTurnSummaries(page)
      // Hover the row, not the path text: hovering the text scrolls the
      // clipped title sideways to bring it into view.
      await page
        .getByRole("button", { name: /^Read 3 lines/ })
        .first()
        .hover({ timeout: 10_000 })
      await showTooltip(page)
    },
    settleMs: 400,
  },
  {
    name: "canvas-chat-disclosure-focus",
    description:
      "A collapsible chat section (reasoning) reached from the keyboard, showing its focus ring.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "Checkout polish")
      await expandTurnSummaries(page)
      // Reach it with the keyboard (focus back, then Tab onto it) so the
      // browser treats the focus as keyboard focus and paints the ring.
      await page
        .getByRole("button", { name: /^Reasoning$/ })
        .first()
        .focus({ timeout: 15_000 })
      await page.keyboard.press("Shift+Tab")
      await page.keyboard.press("Tab")
    },
    settleMs: 400,
  },
]

export default screens

/** Paste a tiny PNG into the visible chat composer. */
async function pasteImageInComposer(page: Page): Promise<void> {
  await page
    .locator(".tiptap:visible")
    .last()
    .evaluate((el) => {
      const bytes = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        ),
        (c) => c.charCodeAt(0)
      )
      const data = new DataTransfer()
      data.items.add(new File([bytes], "mockup.png", { type: "image/png" }))
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        })
      )
    })
}

/** A run part-way through: the prompt, a finished tool call, and half a reply. */
function streamingRun(): RunEvent[] {
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text("Make the order summary sticky on mobile."),
      },
    },
    { type: "chat-stream-start" },
    { type: "chat-control", control: { kind: "steerable", steerable: true } },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "fixture-read",
        title: "Read app/checkout/summary.tsx",
        kind: "read",
        status: "completed",
      },
    },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text(
          "The summary sits in the right column, so on mobile it lands under the form. I'll pin it to the bottom of the viewport below 768px and"
        ),
      },
    },
  ]
}

async function expandToolCall(page: Page, name: RegExp): Promise<void> {
  const row = page.getByRole("button", { name }).first()
  await row.waitFor({ timeout: 10_000 })
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.click()
}

/**
 * A finished run with one tool call in every state the row has: a read whose
 * path overflows the row, an edit carrying a diff, a command that failed with
 * a reason and one that failed with none, and a command still running. It ends
 * on a transcript error long enough to wrap.
 */
function toolStatesRun(): RunEvent[] {
  const call = (update: Record<string, unknown>): RunEvent => ({
    type: "chat-acp-update",
    update: { sessionUpdate: "tool_call", ...update },
  })
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text("Pin the order summary on mobile and run the build."),
      },
    },
    { type: "chat-stream-start" },
    call({
      toolCallId: "fixture-states-read",
      title:
        "Read apps/storefront/app/(checkout)/components/summary/sticky-order-summary.tsx",
      kind: "read",
      status: "completed",
      rawInput: {
        file_path:
          "apps/storefront/app/(checkout)/components/summary/sticky-order-summary.tsx",
      },
      content: [
        {
          type: "content",
          content: text(
            '     1→export function StickyOrderSummary() {\n     2→  return <aside className="md:static" />\n     3→}'
          ),
        },
      ],
    }),
    call({
      toolCallId: "fixture-states-edit",
      title: "Edit app/checkout/summary.tsx",
      kind: "edit",
      status: "completed",
      rawInput: { file_path: "app/checkout/summary.tsx" },
      content: [
        {
          type: "diff",
          path: "app/checkout/summary.tsx",
          oldText: [
            "export function OrderSummary({ items }: Props) {",
            "  return (",
            '    <aside className="md:static">',
            "      <Totals items={items} />",
            "    </aside>",
            "  )",
            "}",
          ].join("\n"),
          newText: [
            "export function OrderSummary({ items }: Props) {",
            "  return (",
            '    <aside className="sticky bottom-0 md:static">',
            "      <Totals items={items} />",
            "      <PayButton />",
            "    </aside>",
            "  )",
            "}",
          ].join("\n"),
        },
      ],
    }),
    call({
      toolCallId: "fixture-states-build",
      title: "pnpm build",
      kind: "execute",
      status: "failed",
      rawInput: { command: "pnpm build --filter storefront" },
      content: [
        {
          type: "content",
          content: text(
            "app/checkout/summary.tsx:5:8 - error TS2304: Cannot find name 'PayButton'.\n\nFound 1 error in app/checkout/summary.tsx:5"
          ),
        },
      ],
    }),
    call({
      toolCallId: "fixture-states-deploy",
      title: "Preview deploy",
      kind: "execute",
      status: "failed",
      rawInput: { command: "pnpm deploy:preview" },
    }),
    call({
      toolCallId: "fixture-states-test",
      title: "pnpm test",
      kind: "execute",
      status: "in_progress",
      rawInput: {
        command:
          "pnpm test --filter storefront -- app/checkout/summary.test.tsx --reporter=verbose",
      },
    }),
    {
      type: "chat-control",
      control: {
        kind: "error",
        message:
          "The agent stopped responding: request to https://api.example.com/v1/sessions/4f9c2e1a-8b7d-4c3e-9a2f-1d5e6b7c8a9f/prompt timed out after 120000ms",
      },
    },
  ]
}
