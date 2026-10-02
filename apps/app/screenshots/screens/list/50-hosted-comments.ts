import type { Page } from "playwright-core"

import { LOCAL_USER_ID } from "@/lib/local-user"
import type { AgentMessage } from "@/lib/agent/types"

import { COLLABORATOR_ID } from "../../fixtures/world"
import type { Screen } from "../screen"
import {
  canvasPanels,
  ids,
  unfreeze,
  CHAT_WORKSPACE,
  selectWorkspace,
  questionRun,
  replyInChatFromBrief,
} from "../helpers"

const screens: Screen[] = [
  // --- Hosted build only (`--hosted`): comments (#789) ---
  {
    name: "canvas-chat-senders-web",
    description:
      "A shared Canvas's chat in the web build: Jordan's message and Priya's answer to the question card, each named.",
    hosted: true,
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: async (page) => {
      // The hosted build has no replay handle, so the chat's history is
      // served as the server would after the turn: the question run's
      // messages, sent and answered by two members.
      await page.route("**/api/agent/history?*", (route) =>
        route.fulfill({ json: sharedQuestionTranscript() })
      )
      await page.reload()
      await selectWorkspace(page, CHAT_WORKSPACE)
      await page
        .getByTestId("question-card")
        .first()
        .waitFor({ timeout: 15_000 })
      await page
        .getByTestId("message-sender")
        .first()
        .waitFor({ timeout: 10_000 })
        .catch(() => {})
      await page.mouse.move(0, 0)
    },
    settleMs: 400,
  },
  {
    name: "canvas-document-reply-in-chat-web",
    description:
      "Reply in chat (#1243) in the web build: a Document line quoted into the Checkout polish chat's composer.",
    hosted: true,
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    prepare: replyInChatFromBrief,
    settleMs: 400,
  },
  {
    name: "canvas-share-dialog",
    description:
      "Share in the canvas top bar: invite by email, people with access.",
    hosted: true,
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await page
        .getByRole("button", { name: "Share", exact: true })
        .click({ timeout: 30_000 })
      const dialog = page.getByRole("dialog")
      await dialog.waitFor({ state: "visible", timeout: 10_000 })
      await dialog
        .getByRole("list")
        .waitFor({ timeout: 10_000 })
        .catch(() => {})
    },
    settleMs: 400,
  },
  {
    name: "player-comments",
    description:
      "The player on /checkout with its Workspace's comment pins on the page.",
    hosted: true,
    path: playerCommentsPath(),
    prepare: async (page) => {
      await page
        .locator("[data-comment-pin]")
        .first()
        .waitFor({ timeout: 30_000 })
        .catch(() => {})
    },
    settleMs: 300,
  },
  {
    name: "player-comment-thread",
    description: "A pin opened in the player: the canvas's thread card.",
    hosted: true,
    path: playerCommentsPath(),
    prepare: async (page) => {
      await unfreeze(page)
      const pin = page.locator("[data-comment-pin]").first()
      await pin.waitFor({ timeout: 30_000 })
      await pin.click()
      await page.getByRole("dialog").first().waitFor({ timeout: 10_000 })
    },
    settleMs: 400,
  },
  {
    name: "player-comments-list",
    description:
      "The player's comment list: this route first, then other routes, then the old feed's notes.",
    hosted: true,
    path: playerCommentsPath(),
    prepare: async (page) => {
      await unfreeze(page)
      await page
        .locator("[data-comment-pin]")
        .first()
        .waitFor({ timeout: 30_000 })
        .catch(() => {})
      await openCommentList(page)
    },
    settleMs: 400,
  },
  {
    name: "player-comment-composer",
    description:
      "C in the player, then a click on the order form: the composer on that element.",
    hosted: true,
    path: playerCommentsPath(),
    prepare: async (page) => {
      await unfreeze(page)
      const field = page
        .frameLocator("iframe")
        .locator("section.cols > div.card > .bar.tall")
      await field.waitFor({ timeout: 30_000 })
      await page.keyboard.press("c")
      const box = await field.boundingBox()
      if (!box) throw new Error("the order form has no box")
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2)
      await page
        .getByPlaceholder("Add a comment…")
        .pressSequentially("Put Apple Pay above the card fields.", {
          timeout: 10_000,
        })
    },
    settleMs: 400,
  },
  {
    name: "canvas-comments-list",
    description:
      "The canvas's comment list: the same threads the player shows, the player's included.",
    hosted: true,
    path: `/${ids.rooms.checkout}`,
    prepare: async (page) => {
      await unfreeze(page)
      await openCommentList(page)
    },
    settleMs: 400,
  },
]

export default screens

/**
 * {@link questionRun}'s transcript as the history route serves it, with the
 * ask sent by the fixture user and the card answered by their collaborator.
 */
function sharedQuestionTranscript(): AgentMessage[] {
  const out: AgentMessage[] = []
  for (const event of questionRun()) {
    if (event.type !== "chat-acp-update") continue
    const u = event.update as {
      sessionUpdate: string
      content?: { text: string }
      toolCallId?: string
      title?: string
      kind?: string
      status?: string
      rawInput?: unknown
    }
    if (u.sessionUpdate === "user_message_chunk") {
      out.push({
        role: "user",
        content: u.content!.text,
        sentBy: LOCAL_USER_ID,
      })
    } else if (u.sessionUpdate === "agent_message_chunk") {
      out.push({ role: "assistant", content: u.content!.text })
    } else if (u.sessionUpdate === "tool_call") {
      out.push({
        role: "tool_call",
        toolCallId: u.toolCallId!,
        title: u.title!,
        kind: u.kind as never,
        status: u.status as never,
        content: [],
        rawInput: u.rawInput,
      })
    }
  }
  out.push({
    role: "user",
    content: "Pin to the bottom",
    sentBy: COLLABORATOR_ID,
  })
  return out
}

/** The player on the Checkout canvas's Mobile checkout Workspace, at /checkout. */
function playerCommentsPath(): string {
  return `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}?route=/checkout`
}

/**
 * Open the comment list: the count button in the canvas top bar or the player
 * HUD (before #789, the HUD's Comments panel). Retried, since a click can land
 * before hydration wires the button.
 */
async function openCommentList(page: Page): Promise<void> {
  const button = page
    .getByRole("button", { name: /^(\d+ comments?(, \d+ unread)?|Comments)$/ })
    .first()
  const list = page.getByText(/^(Comments|Workspace comments)$/)
  for (let i = 0; i < 5 && !(await list.count()); i++) {
    await button.click({ timeout: 15_000 })
    await page.waitForTimeout(500)
  }
}
