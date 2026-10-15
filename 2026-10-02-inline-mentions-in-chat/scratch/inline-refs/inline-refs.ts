import type { Page } from "playwright-core"

import { roomChatId } from "@/lib/chat/room-chat"
import { userTurnEcho } from "@/lib/agent/user-turn"
import { wakeMessage } from "@/lib/agent/coordinator-wake"
import type { Screen } from "../screen"
import {
  canvasPanels,
  ids,
  openChatTab,
  replayRun,
  text,
  typeInComposer,
  type RunEvent,
} from "../helpers"

// Inline references exploration (round 1). REFS_TODAY=1 writes the Coordinator's
// frame / document / mockup names as plain words, the way main can today.
const TODAY = process.env.REFS_TODAY === "1"

const link = (label: string, href: string) =>
  TODAY && !href.startsWith("workspace:") ? label : `[${label}](${href})`

function userTurn(body: string): RunEvent {
  return {
    type: "chat-acp-update",
    update: userTurnEcho(body),
  }
}

function reply(body: string): RunEvent[] {
  return [
    { type: "chat-stream-start" },
    {
      type: "chat-acp-update",
      update: { sessionUpdate: "agent_message_chunk", content: text(body) },
    },
    { type: "chat-stream-end" },
  ]
}

function coordinatorRun(): RunEvent[] {
  return [
    userTurn(
      "What's left on checkout? [@Checkout brief](mention:doc-checkout-brief) has the list."
    ),
    ...reply(
      `${link("Checkout polish", `workspace:${ids.branches.checkoutPolish}`)} is done: the order summary now stays pinned above the Pay button in ${link("Checkout · iPhone 17 Pro", "frame:layer-checkout-mobile")}.\n\n` +
        `${link("Empty cart state", `workspace:${ids.branches.emptyCart}`)} is waiting for you to approve its plan. It drew two takes, ${link("Option A · Illustrated", "mockup:mockup-cart-illustrated")} and ${link("Option B · Suggestions", "mockup:mockup-cart-suggestions")}, and kept its notes in ${link("Checkout brief", "document:doc-checkout-brief")}.\n\n` +
        `${link("Apple Pay button", `workspace:${ids.branches.applePay}`)} is still setting up.`
    ),
    {
      type: "chat-acp-update",
      update: userTurnEcho(
        wakeMessage({
          workspaceId: ids.branches.checkoutPolish,
          title: "Checkout polish",
          status: "completed",
          lastTurn: "Last ask: …",
        })
      ),
    },
  ]
}

function workspaceRun(): RunEvent[] {
  return [
    userTurn(
      "Make [element: button#pay](element:fixture-ref-pay) stick to the bottom on mobile, like [@Checkout brief](mention:doc-checkout-brief) says.\n\n" +
        "Sketch it in Mockup [mockup: mockup-receipt] with update_mockup, for a 390 × 844 viewport."
    ),
    ...reply("On it. I'll pin the button and sketch the receipt next to it."),
  ]
}

async function openCoordinator(page: Page) {
  await page
    .getByText("Ask about this canvas")
    .first()
    .waitFor({ timeout: 30_000 })
  await replayRun(page, roomChatId(ids.rooms.checkout), coordinatorRun())
  await page
    .getByText("is still setting up")
    .first()
    .waitFor({ timeout: 10_000 })
}

const screens: Screen[] = [
  {
    name: "refs-coordinator",
    description: "Coordinator reply naming Workspaces, a frame, mockups, a doc.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: openCoordinator,
    settleMs: 600,
  },
  {
    name: "refs-workspace-chat",
    description: "Sent message with an element token, a doc mention, a mockup ref.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await replayRun(page, ids.chats.fresh, workspaceRun())
      await page.getByText("On it.").first().waitFor({ timeout: 10_000 })
    },
    settleMs: 600,
  },
  {
    name: "refs-composer",
    description: "Composer with a doc mention typed.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      await openChatTab(page, "New chat")
      await typeInComposer(page, "Follow @Check")
      await page.keyboard.press("Enter")
      await page.keyboard.type("for the sticky button")
      await page.mouse.move(900, 900)
    },
    settleMs: 600,
  },
]

export default screens
