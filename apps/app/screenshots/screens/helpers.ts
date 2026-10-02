import { fixtureFaultCookieName, type FixtureFault } from "@/lib/fixture-faults"
import { fixtureModelCookieName } from "@/lib/fixture-model"
import { execFileSync } from "node:child_process"
import { mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Locator, Page } from "playwright-core"
import * as Y from "yjs"

import {
  DEFAULT_VIEW_PREFS,
  homeViewPrefsCookieName,
  withView,
  type View,
} from "@/lib/home-view-prefs"
import {
  fixtureEntryCookieName,
  type FixtureEntryState,
} from "@/lib/fixture-entry"
import { fixtureGitHubCookieName } from "@/lib/fixture-github"
import { panelLayoutCookieName } from "@/lib/panel-layout"
import { roomChatId } from "@/lib/chat/room-chat"
import { prependTurnMarkers } from "@/lib/agent/message-markers"
import { userTurnEcho } from "@/lib/agent/user-turn"
import { workspaceLink } from "@/lib/agent/workspace-task"
import { wakeMessage } from "@/lib/agent/coordinator-wake"
import { getRoomCollections, type RoomCollections } from "@/lib/yjs/schema"

import { FIXTURE_IDS } from "../fixtures/world"
import { NARROW_HOME_VIEWPORT } from "./screen"

/**
 * Shared steps, stubs and fixtures the screen files build on. Add a helper
 * here only once a second screen file needs it; until then it lives in the
 * file that uses it.
 */

/**
 * Hold every WebSocket open without ever answering it, so the Canvas stays on
 * its loading skeleton: the room provider paints the skeleton until the Y.Doc
 * syncs, and a socket nobody speaks on never syncs. Used by the loading screen
 * and recording, which would otherwise be gone before the first frame.
 */
export async function holdYjsConnection(page: Page): Promise<void> {
  await page.routeWebSocket(/.*/, () => {
    // Not connecting to the server is the point: the socket opens and stays
    // silent.
  })
}

/**
 * The cookie that opens the canvas's chat panel. The chat panel defaults to 0px
 * (collapsed), so every chat screen seeds it rather than clicking ⌘I — the shot
 * then paints correct instead of being toggled correct.
 *
 * The values are **percentages of the group**, which is the shape
 * `react-resizable-panels` persists, and all three panels must be named or the
 * layout is ignored. Written through the app's own `panelLayoutCookieName` so a
 * rename of the cookie can't quietly strand these screens on a collapsed panel.
 */
export function canvasPanels(layout: {
  sidebarPct?: number
  chatPct?: number
}): Array<{ name: string; value: string }> {
  const sidebar = layout.sidebarPct ?? 16
  const chat = layout.chatPct ?? 0
  return [
    {
      name: panelLayoutCookieName("canvas-layout"),
      value: encodeURIComponent(
        JSON.stringify({ sidebar, canvas: 100 - sidebar - chat, chat })
      ),
    },
  ]
}

export const ids = FIXTURE_IDS

/** The Checkout canvas's desktop frame, by its title. */
export function checkoutDesktopFrame(page: Page) {
  return page.locator("[data-iframe-layer]", {
    has: page.getByText("Checkout · desktop", { exact: true }),
  })
}

export function isHomePath(url: string): boolean {
  return new URL(url).pathname === "/"
}

/**
 * Open a menu from its trigger and pick an item, walking into submenus: pass
 * `["Restart", "Recreate from scratch"]` to hover the first and click the last.
 */
/**
 * Run a saved Project preset row's action: from its … menu (#784), or from a
 * button of that name on builds before the menu, so "before" captures work.
 */
export async function presetRowAction(
  page: Page,
  action: string
): Promise<void> {
  const more = page.getByRole("button", { name: "More actions" }).first()
  if (await more.isVisible()) {
    await chooseFromMenu(page, more, [action])
    return
  }
  await page
    .getByRole("button", { name: action, exact: true })
    .first()
    .click({ timeout: 15_000 })
}

export async function chooseFromMenu(
  page: Page,
  trigger: Locator,
  path: string | string[]
): Promise<void> {
  const steps = typeof path === "string" ? [path] : path
  // Hover-revealed triggers (sidebar rows) only take a click once their row
  // is hovered.
  await trigger
    .locator("xpath=..")
    .hover({ timeout: 15_000 })
    .catch(() => {})
  await trigger.click({ timeout: 15_000, force: true })
  for (const [i, label] of steps.entries()) {
    // Radix ignores a select that lands in the same beat the menu opened.
    await page.waitForTimeout(300)
    const item = page.getByRole("menuitem", { name: label, exact: true }).last()
    if (i < steps.length - 1) {
      // Open the submenu the way a keyboard user does.
      await item.focus({ timeout: 10_000 })
      await item.press("ArrowRight")
    } else {
      await item.click({ timeout: 10_000 })
    }
  }
}

/**
 * The `…` menu trigger on the sidebar row whose text is `text`: the nearest
 * ancestor of the text that holds a menu trigger, hovered so the trigger shows.
 */
export function rowMenuTrigger(page: Page, text: string): Locator {
  const label = page.getByText(text, { exact: true }).first()
  return label
    .locator(
      "xpath=ancestor::*[.//button[@aria-haspopup='menu']][1]//button[@aria-haspopup='menu']"
    )
    .first()
}

export async function branchRowMenu(page: Page, ref: string): Promise<Locator> {
  const row = await workspaceMenuRow(page, ref)
  await row.hover({ timeout: 15_000 })
  return row.getByRole("button", { name: "Workspace options" })
}

/**
 * Hold every Next.js server action from here on: `hang` never answers (the
 * pending state), `fail` answers 500 (the error state). Either way the server
 * never runs the action, so the Fixture World is untouched.
 */
export async function holdServerActions(
  page: Page,
  mode: "hang" | "fail"
): Promise<void> {
  await page.route("**/*", async (route) => {
    const request = route.request()
    if (request.method() !== "POST" || !request.headers()["next-action"]) {
      return route.fallback()
    }
    if (mode === "fail") {
      return route.fulfill({ status: 500, body: "Internal Server Error" })
    }
    // hang: leave the request unanswered.
  })
}

/**
 * Answer the Canvas's Yjs socket with a doc built here instead of the Fixture
 * World's, for a state the seeded world can't hold without changing every other
 * screen of that Canvas (a Workspace with no sandbox yet, one deleted while the
 * player is open). The socket never reaches the server, so nothing is written
 * back; the server render still reads the seeded doc.
 *
 * It sends one sync step 2 — y-websocket's "here is the whole doc" — which is
 * all the client needs to count itself synced.
 */
export async function serveYjsDoc(
  page: Page,
  build: (collections: RoomCollections) => void
): Promise<void> {
  const doc = new Y.Doc()
  const collections = getRoomCollections(doc)
  collections.transact(() => build(collections))
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  // messageSync (0), syncStep2 (1), then the update as a length-prefixed buffer.
  const message = Buffer.concat([
    Buffer.from([0, 1, ...varUint(update.length)]),
    Buffer.from(update),
  ])
  // Answer the client's opening sync step 1, as the server would. Next's own
  // dev socket (`/_next/webpack-hmr`) is left alone.
  await page.routeWebSocket(/^(?!.*\/_next\/)/, (ws) => {
    let answered = false
    ws.onMessage(() => {
      if (answered) return
      answered = true
      ws.send(message)
    })
  })
}

/** The Project the getting-started screens add, as a folder pick would. */
export const gettingStartedRepo = {
  id: "repo-getting-started",
  name: "storefront",
  repoFullName: "acme/storefront",
  repoOwner: "acme",
  repoName: "storefront",
  defaultBranch: "main",
  cloneUrl: "https://github.com/acme/storefront.git",
  setupScript: "pnpm install",
  devScript: "pnpm dev --port $PORT",
  devServerPort: 3000,
  envVars: "",
  createdAt: 0,
  sidebarOrder: 0,
}

/** lib0's unsigned varint: 7 bits a byte, high bit set on all but the last. */
export function varUint(n: number): number[] {
  const bytes: number[] = []
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  bytes.push(n)
  return bytes
}

/**
 * Reload the page with the Yjs socket's client → server direction cut, so
 * local canvas writes (a Workspace flipped to `starting`) render but are never
 * persisted into the Fixture World.
 */
export async function freezeYjs(page: Page): Promise<void> {
  await page.routeWebSocket(/.*/, (ws) => {
    const server = ws.connectToServer()
    let initialSync = true
    // Let the handshake through so the canvas loads, then drop client writes.
    setTimeout(() => (initialSync = false), 5_000)
    ws.onMessage((message) => {
      if (initialSync) server.send(message)
    })
    server.onMessage((message) => ws.send(message))
  })
  await page.reload({ waitUntil: "load" })
  await page.getByText("Empty cart state", { exact: true }).first().waitFor({
    timeout: 60_000,
  })
  await page.waitForTimeout(5_500)
}

/**
 * Fail every server action from here on with a 500, the way a dropped sidecar
 * or a database error reaches the client. A `beforeNavigate` fails a page's
 * loads; a `prepare` calls it once the page is up, so only the mutation it then
 * drives fails.
 */
export async function failServerActions(page: Page): Promise<void> {
  await page.route("**/*", (route) => {
    const request = route.request()
    if (request.method() === "POST" && request.headers()["next-action"]) {
      return route.fulfill({ status: 500, body: "simulated failure" })
    }
    return route.fallback()
  })
}

/**
 * The cookie that puts a Fixture World capture on one of the screens a person
 * meets before the app (`@/lib/fixture-entry`) — the signed-out home or a
 * blocked setup gate, neither of which the always-signed-in, already-set-up
 * fixture build would otherwise show.
 */
export function entryState(
  state: FixtureEntryState
): Array<{ name: string; value: string }> {
  return [{ name: fixtureEntryCookieName(), value: state }]
}

/**
 * The cookie that picks the home surface's grid-or-table layout. Seeded rather
 * than clicked for the same reason as {@link canvasPanels}: the layout is a
 * first-paint decision the server reads off this cookie, so setting it captures
 * the surface as a returning user sees it, with no toggle to find.
 */
export function homeView(view: View): Array<{ name: string; value: string }> {
  return [
    {
      name: homeViewPrefsCookieName(),
      value: encodeURIComponent(
        JSON.stringify(withView(DEFAULT_VIEW_PREFS, view))
      ),
    },
  ]
}

/**
 * The home layout cookie with the sidebar at its 480px maximum, which at
 * {@link NARROW_HOME_VIEWPORT} leaves the content its narrowest (~420px). Like
 * {@link canvasPanels}, the values are percentages of the group; the panel's
 * own `maxSize` clamps anything past 480px.
 */
export function narrowHome(): Array<{ name: string; value: string }> {
  const sidebar = (480 / NARROW_HOME_VIEWPORT.width) * 100
  return [
    {
      name: panelLayoutCookieName("home-layout"),
      value: encodeURIComponent(
        JSON.stringify({
          "home-sidebar": sidebar,
          "home-content": 100 - sidebar,
        })
      ),
    },
  ]
}

/**
 * Pick up the tile or row named `source` and hold it over the one named
 * `target` without letting go, so the shot catches the drop-target highlight.
 *
 * The drag preview floats under the pointer at the spot it was grabbed, so
 * grabbing the source by its bottom edge and hovering the target just inside
 * its top edge keeps the preview above the target rather than on top of it —
 * the drop test is the pointer's position (`pointerWithin`), so that's enough
 * to light it. The sensor waits for 6px of movement before a drag starts, so
 * the pointer nudges first, then travels in steps dnd-kit can track.
 */
export async function dragOnto(
  page: Page,
  source: string,
  target: string
): Promise<void> {
  const draggable = (name: string) =>
    page
      .getByText(name, { exact: true })
      .first()
      .locator(
        "xpath=ancestor-or-self::*[@aria-roledescription='draggable'][1]"
      )
      .boundingBox({ timeout: 15_000 })
  const from = await draggable(source)
  const to = await draggable(target)
  if (!from || !to)
    throw new Error(`drag: ${source} or ${target} not on screen`)
  const grab = { x: from.x + from.width / 2, y: from.y + from.height - 3 }
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x, grab.y - 12)
  await page.mouse.move(to.x + to.width / 2, to.y + 4, { steps: 12 })
}

/**
 * Press Tab until keyboard focus lands on the control named `label`, the way a
 * keyboard user gets there — so the shot shows the `:focus-visible` state a
 * programmatic `.focus()` might not. `within` limits the match to controls
 * inside that selector (the sidebar's pinned rows share their labels with the
 * grid's). Throws after `max` presses, which a `prepare` turns into a warning.
 */
export async function tabTo(
  page: Page,
  label: string,
  options: { within?: string; max?: number; delayMs?: number } = {}
): Promise<void> {
  const { within = "main", max = 60, delayMs = 0 } = options
  const probe = `(() => {
    const el = document.activeElement
    return !!el && el.getAttribute("aria-label") === ${JSON.stringify(label)} &&
      !!el.closest(${JSON.stringify(within)})
  })()`
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab")
    if (delayMs) await page.waitForTimeout(delayMs)
    if (await page.evaluate(probe)) return
  }
  throw new Error(`never reached "${label}" by Tab`)
}

/**
 * Undo the settle step's animation freeze, for a `prepare` that walks through a
 * Radix surface (a menu, a dialog) — those only unmount once their exit
 * animation ends, so a frozen page leaves a closed menu on screen forever. The
 * runner freezes again before the shot.
 */
export async function unfreeze(page: Page): Promise<void> {
  await page.evaluate(`
    for (const el of document.querySelectorAll("style")) {
      if (el.textContent.includes("animation-play-state: paused")) el.remove()
    }
  `)
}

/**
 * The checkout Canvas's Workspace that holds the fixture chats ("Checkout
 * polish", "Breakpoint audit", "New chat") and terminal tabs.
 */
export const CHAT_WORKSPACE = "Checkout polish"

/**
 * Select a Workspace from the Chats menu, which points the chat panel at
 * it and restores that Workspace's remembered chat.
 */
export async function selectWorkspace(page: Page, ref: string): Promise<void> {
  // Rows are labelled with the Workspace's title (#881), or its git ref when
  // it has none: what a person reads off the screen.
  const row = await workspaceMenuRow(page, ref)
  await row.click({ timeout: 15_000 })
  await page.locator(CHATS_MENU).waitFor({ state: "hidden", timeout: 10_000 })
}

/** The chat panel's Chats menu (#1152) while it's open. */
export const CHATS_MENU = "[data-chats-menu]"

/**
 * Open the chat panel's Chats menu (#1152), the one list of the canvas's
 * chats. It sits in the panel's header, so a screen that left the panel
 * collapsed gets it opened (⌘I) first.
 */
export async function openChatsMenu(page: Page): Promise<Locator> {
  const menu = page.locator(CHATS_MENU)
  if (await menu.isVisible()) return menu
  const button = page.getByRole("button", { name: "Chats", exact: true })
  await button.waitFor({ timeout: 15_000 }).catch(() => {})
  if (!(await button.isVisible())) {
    // The button lives on the Coordinator header only (#1152): from a
    // Workspace chat, go back up through the Coordinator crumb.
    const crumb = page.getByRole("button", { name: "Coordinator", exact: true })
    if (await crumb.isVisible()) await crumb.click()
    else await page.keyboard.press("Meta+i")
  }
  await button.click({ timeout: 15_000 })
  await menu.waitFor({ timeout: 10_000 })
  return menu
}

/** A Workspace's row in the Chats menu, opening the menu first. */
export async function workspaceMenuRow(
  page: Page,
  name: string
): Promise<Locator> {
  const menu = await openChatsMenu(page)
  const row = menu
    .locator("[cmdk-item]")
    .filter({ has: page.getByText(name, { exact: true }) })
    .first()
  await row.waitFor({ timeout: 15_000 })
  return row
}

/**
 * The review world's earlier chats (#1315), by label, which screens borrow for
 * their transcripts. The panel has no way to open an earlier chat, so
 * {@link openChatTab} shows one's transcript in the Workspace's own chat.
 */
const EARLIER_CHAT_TRANSCRIPTS: Record<string, string> = {
  "Checkout polish": ids.chats.checkoutPolish,
  "Breakpoint audit": ids.chats.markdown,
}

/**
 * Show one of a Workspace's chats by label. Its own chat is already on show
 * once the Workspace is selected. An earlier chat (#1315) can't be opened, so
 * its transcript is served as the Workspace chat's history instead: the
 * conversation on show is the earlier chat's, in a chat with a composer. That
 * reloads the page, so call it before anything else a screen sets up. The
 * panel itself is opened by {@link canvasPanels}, not from here.
 */
export async function openChatTab(
  page: Page,
  label: string,
  workspace = CHAT_WORKSPACE
): Promise<void> {
  const transcript = EARLIER_CHAT_TRANSCRIPTS[label]
  if (transcript) {
    const fresh = `chatId=${ids.chats.fresh}`
    const isFreshHistory = (url: URL) =>
      url.pathname.endsWith("/api/agent/history") && url.search.includes(fresh)
    await page.route(isFreshHistory, async (route) => {
      const url = route.request().url().replace(ids.chats.fresh, transcript)
      await route.fulfill({ response: await route.fetch({ url }) })
    })
    // Every chat's history loads with the canvas, so load it again.
    await page.reload()
  }
  // The panel opens on the Coordinator (#893); a Workspace's chats live in
  // its panel.
  await selectWorkspace(page, workspace)
  // A cold dev server can hold the history load past the settle delay.
  await page
    .getByText("Loading chat…")
    .first()
    .waitFor({ state: "hidden", timeout: 30_000 })
    .catch(() => {})
}

/** Type into the visible chat composer, as a user would. */
export async function typeInComposer(page: Page, text: string): Promise<void> {
  const editor = page.locator(".tiptap:visible").last()
  await editor.click({ timeout: 15_000 })
  await page.keyboard.type(text)
}

/**
 * Open a fresh shell with the tab strip's "+" (New terminal): a Workspace has
 * one chat (#1315), so "+" only ever opens shells (#1343).
 *
 * Opened rather than restored: the fixture world does seed two terminal tabs,
 * but a cold room load currently prunes them as orphans before its Workspaces
 * arrive, so they can't be relied on to be there.
 */
export async function openTerminalTab(page: Page): Promise<void> {
  await openTerminalPane(page)
  await page
    .getByRole("button", { name: "New terminal", exact: true })
    .first()
    .click({ timeout: 15_000 })
  await page.mouse.move(0, 0)
}

/**
 * Open a Workspace's Terminal Pane (#1341) on one of its terminals, by its name
 * in the footnote under the composer.
 */
export async function openTerminalPane(
  page: Page,
  name = "Dev server",
  workspace = CHAT_WORKSPACE
): Promise<void> {
  await selectWorkspace(page, workspace)
  await page
    .getByRole("tablist", { name: "Terminals" })
    .getByRole("tab", { name, exact: true })
    .first()
    .click({ timeout: 15_000 })
}

/**
 * One chat broadcast event, minus the `chatId`/`id` envelope {@link replayRun}
 * fills in. The same shapes `ChatBroadcastEvent` defines in `lib/chat-store.ts`.
 */
export type RunEvent = Record<string, unknown> & { type: string }

/**
 * Replay a run's broadcast events into a chat. The harness has no agent to run,
 * so a run's live states (streaming, stopped) are reached by feeding the chat
 * store the events a real run broadcasts, through the handle the Fixture World
 * build exposes. Passed as a source string for the same `__name` reason as the
 * theme init script (`lib/browser.ts`).
 */
export async function replayRun(
  page: Page,
  chatId: string,
  events: readonly RunEvent[]
): Promise<void> {
  const payload = JSON.stringify(
    events.map((e, i) => ({
      ...e,
      chatId,
      id: `fixture-${chatId}-${Date.now()}-${i}`,
    }))
  )
  await page.evaluate(
    `for (const e of ${payload}) window.__chatStore?.handleBroadcastEvent(e)`
  )
}

export const text = (t: string) => ({ type: "text", text: t })

/**
 * Answer a send to `chatId`'s running turn the way the server does when it
 * steers (#1190): the message joins the run as a pending Steer, which the
 * server announces to the Room. No agent runs here to take it.
 */
export async function stubSteer(page: Page, chatId: string): Promise<void> {
  let n = 0
  await page.route("**/api/agent/stream", async (route) => {
    const { message } = route.request().postDataJSON() as { message: string }
    const steerId = `fixture-steer-${++n}`
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ chatId, steered: true, steerId }),
    })
    await replayRun(page, chatId, [
      {
        type: "chat-control",
        control: { kind: "steer_pending", steer: { id: steerId, message } },
      },
    ]).catch(() => {})
  })
}

/**
 * A finished turn that ends on a question card (#1312): the prompt, a read,
 * a line of narration and the `ask_question` call.
 */
export function questionRun(): RunEvent[] {
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text("Make the order summary sticky on mobile."),
      },
    },
    { type: "chat-stream-start" },
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
          "On mobile the summary lands under the form. There are two ways to keep it in view."
        ),
      },
    },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "fixture-question",
        title: "ask_question",
        kind: "other",
        status: "completed",
        rawInput: {
          question: "Where should the order summary stay on mobile?",
          options: [
            {
              label: "Pin to the bottom",
              detail: "A collapsed total bar that expands on tap",
            },
            {
              label: "Pin to the top",
              detail: "Stays under the header while you scroll",
            },
            { label: "Leave it inline" },
          ],
          recommended: 0,
        },
      },
    },
    { type: "chat-stream-end" },
  ]
}

/** The ask the Coordinator splits across two Workspaces (#896). */
export const DELEGATED_STICKY =
  "Make the order summary sticky on mobile, below 768px."

/**
 * Coordinator wakes after the delegation (#897): Checkout polish finished and
 * the Coordinator reports it; a quiet wake it answers with nothing; then Empty
 * cart state stops for plan approval and the Coordinator links it.
 */
export function coordinatorWakeRun(): RunEvent[] {
  const wake = (
    branchId: string,
    title: string,
    status: "completed" | "paused_for_plan",
    reply?: string
  ): RunEvent[] => [
    {
      type: "chat-acp-update",
      update: userTurnEcho(
        wakeMessage({
          workspaceId: branchId,
          title,
          status,
          lastTurn: "Last ask: …",
        })
      ),
    },
    { type: "chat-stream-start" },
    // It reads the Workspace's chat before deciding whether to say anything.
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: `fixture-wake-read-${branchId}-${status}-${reply ? 1 : 0}`,
        title: "read_workspace_chat",
        kind: "read",
        status: "completed",
      },
    },
    ...(reply
      ? [
          {
            type: "chat-acp-update",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: text(reply),
            },
          } satisfies RunEvent,
        ]
      : []),
    { type: "chat-stream-end" },
  ]
  return [
    ...wake(
      ids.branches.checkoutPolish,
      "Checkout polish",
      "completed",
      `${workspaceLink("Checkout polish", ids.branches.checkoutPolish)} is done: the order summary now stays pinned above the Pay button on mobile.`
    ),
    ...wake(ids.branches.checkoutPolish, "Checkout polish", "completed"),
    ...wake(
      ids.branches.emptyCart,
      "Empty cart state",
      "paused_for_plan",
      `${workspaceLink("Empty cart state", ids.branches.emptyCart)} is waiting for you to approve its plan.`
    ),
  ]
}

/**
 * A Coordinator wake still running (#897): Checkout polish's turn just ended
 * and the Coordinator is reading its chat, not yet replying.
 */
export function coordinatorWakeRunningRun(): RunEvent[] {
  return [
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
    { type: "chat-stream-start" },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: text("Checkout polish finished; checking what it changed."),
      },
    },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "fixture-wake-running-read",
        title: "read_workspace_chat",
        kind: "read",
        status: "in_progress",
      },
    },
  ]
}

/**
 * A Workspace turn the Coordinator started: the Delegated Message (its turn
 * markers, as persisted), a step, and the agent's reply.
 */
export function delegatedWorkspaceRun(): RunEvent[] {
  return [
    {
      type: "chat-acp-update",
      update: userTurnEcho(
        prependTurnMarkers(DELEGATED_STICKY, {
          delegatedFrom: roomChatId(ids.rooms.checkout),
        })
      ),
    },
    { type: "chat-stream-start" },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "fixture-delegated-read",
        title: "read_file",
        kind: "read",
        status: "completed",
        rawInput: { path: "app/checkout/summary.tsx" },
      },
    },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "fixture-delegated-edit",
        title: "edit_file",
        kind: "edit",
        status: "completed",
        rawInput: { path: "app/checkout/summary.tsx" },
      },
    },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text(
          "The summary is now `position: sticky` at the bottom of the viewport below 768px, with a top border so it separates from the form."
        ),
      },
    },
    { type: "chat-stream-end" },
  ]
}

/**
 * Expand a collapsed tool-call row whose accessible name matches `name`. Skips
 * a row that already reports itself open, so a row that opens by default (a
 * failed call showing its reason) isn't toggled shut.
 */
/**
 * Open every finished turn's summary line, so the steps folded behind it show.
 * Tolerates a transcript with none (a build from before #800), so the same
 * screens shoot a "before" set.
 */
export async function expandTurnSummaries(page: Page): Promise<void> {
  await page
    .locator('[data-testid="turn-summary-trigger"]:visible')
    .first()
    .waitFor({ timeout: 5_000 })
    .catch(() => {})
  // Other chat tabs stay mounted but hidden, so only the visible ones count.
  const closed = page.locator(
    '[data-testid="turn-summary-trigger"][aria-expanded="false"]:visible'
  )
  while ((await closed.count()) > 0) await closed.first().click()
}

export async function showTooltip(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `[data-slot="tooltip-content"] { animation: none !important; }`,
  })
  await page
    .locator('[data-slot="tooltip-content"]')
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => {})
}

/** Select the Checkout Canvas's desktop frame and wait for its toolbar. */
/** The Workspace hover card (#882), which opens after its hover delay. */
export async function waitForWorkspaceHoverCard(page: Page): Promise<void> {
  await page
    .locator("[data-slot=hover-card-content]")
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
}

export async function selectCheckoutFrame(page: Page): Promise<void> {
  await page
    .getByText("Checkout · desktop", { exact: true })
    .first()
    .click({ timeout: 15_000 })
  await page
    .locator("#frame-toolbar-portal button")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
}

export function fixtureGitHub(): Array<{ name: string; value: string }> {
  return [{ name: fixtureGitHubCookieName(), value: "connected" }]
}

/** Open Canvas settings from the canvas name's ⋯ menu (#883). */
export async function openCanvasSettings(page: Page): Promise<void> {
  await openCanvasOptions(page)
  await page.getByRole("menuitem", { name: "Settings" }).click()
  await page.getByRole("dialog", { name: "Canvas settings" }).waitFor()
}

/** Open the canvas name's ⋯ menu. The first click can land before hydration,
 *  so retry until the menu is up. */
export async function openCanvasOptions(page: Page): Promise<void> {
  const settings = page.getByRole("menuitem", { name: "Settings" })
  for (let attempt = 0; attempt < 10; attempt++) {
    await page.getByRole("button", { name: "Canvas options" }).click()
    try {
      await settings.waitFor({ timeout: 1500 })
      return
    } catch {
      await page.keyboard.press("Escape")
    }
  }
  await settings.waitFor()
}

/** The Chats menu's New chat (+) button (#1152), menu opened. */
export async function newWorkspaceButton(page: Page): Promise<Locator> {
  const menu = await openChatsMenu(page)
  const button = menu.getByRole("button", { name: "New chat" })
  await button.waitFor({ timeout: 15_000 })
  return button
}

/**
 * Open Add repository from Canvas settings (the one place it lives since
 * #884) and pick one of its two entries: `github` (the repo list) or `folder`
 * (the native folder dialog, which a capture browser can't reach, so it falls
 * back to the path form). The first click can land before hydration, so retry
 * until the menu is up.
 */
export async function openAddProject(
  page: Page,
  entry: "github" | "folder"
): Promise<void> {
  await unfreeze(page)
  const settings = page.getByRole("dialog", { name: "Canvas settings" })
  if (!(await settings.count())) await openCanvasSettings(page)
  const menu = page.getByRole("menu")
  for (let i = 0; i < 5 && !(await menu.count()); i++) {
    await settings
      .getByRole("button", { name: "Add repository" })
      .first()
      .click({ timeout: 15_000 })
    await page.waitForTimeout(500)
  }
  await page
    .getByRole("menuitem", {
      name: entry === "github" ? "Open GitHub repository" : "Open folder",
    })
    .click()
  await page.getByRole("dialog").last().waitFor({ timeout: 15_000 })
}

/**
 * Two folders on this machine for the Local folder tab: `checkout`, a git
 * checkout of a pnpm app (so detection has something to find), and `plain`, a
 * folder that isn't a repository. Rebuilt on every call; cheap and idempotent.
 */
export function fixtureCheckouts(): { checkout: string; plain: string } {
  const root = join(tmpdir(), "screenplay-fixture-folders")
  const checkout = join(root, "storefront")
  const plain = join(root, "sketches")
  mkdirSync(checkout, { recursive: true })
  mkdirSync(plain, { recursive: true })
  writeFileSync(
    join(checkout, "package.json"),
    JSON.stringify(
      {
        name: "storefront",
        packageManager: "pnpm@10.0.0",
        scripts: {
          dev: "next dev -p 4000",
          "db:generate": "prisma generate",
        },
        dependencies: { next: "15.0.0" },
      },
      null,
      2
    )
  )
  writeFileSync(join(checkout, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
  writeFileSync(
    join(checkout, "README.md"),
    "# Storefront\n\nRun `pnpm install` and `pnpm db:generate` once, then `pnpm dev` and open http://localhost:4000.\n"
  )
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: checkout })
  return { checkout, plain }
}

/** Reply in chat (#1243) from the Checkout brief into the Checkout polish chat. */
export async function replyInChatFromBrief(page: Page): Promise<void> {
  await openChatTab(page, "Checkout polish")
  // The Checkout brief, clear of the chat panel. The hosted build has no
  // camera handle, so it zooms to fit instead.
  if (await page.evaluate("!!window.__canvasCamera")) {
    await page.evaluate("window.__canvasCamera.setTransform(-1190, 40, 0.7)")
  } else {
    // Zoom to fit, which clears the panel.
    await page.keyboard.press("Shift+Digit1")
    await page.waitForTimeout(500)
  }
  const line = page
    .locator("[data-markdown-layer]")
    .getByText("Does Apple Pay sit above", { exact: false })
  await line.first().waitFor({ state: "visible", timeout: 15_000 })
  const box = await line.first().boundingBox()
  if (!box) throw new Error("line has no box")
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
  await page
    .locator('[data-markdown-layer] [contenteditable="true"]')
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
  await page.keyboard.press("End")
  await page.keyboard.press("Shift+Home")
  await page
    .locator("#inline-comment-bubble-portal")
    .getByRole("button", { name: "Reply in chat" })
    .click({ timeout: 15_000 })
  // The composer takes focus on the next frame, or once it mounts when the
  // hosted Workspace is still starting its sandbox.
  await page
    .locator("[data-composer]:focus")
    .waitFor({ timeout: 60_000 })
    .catch(() => {})
  await page.keyboard.type("Above, like the mobile mock?")
  await page.mouse.move(0, 0)
}

/**
 * The cookie that asks the Fixture World for a server-side failure
 * (`@/lib/fixture-faults`) — one the browser can't cause, like the home layout's
 * own Canvas load.
 */
export function fixtureFault(
  fault: FixtureFault
): Array<{ name: string; value: string }> {
  return [{ name: fixtureFaultCookieName(), value: fault }]
}

/** Make a model reachable for settings detection (`slow` answers after 20s). */
export function fixtureModel(
  mode: "connected" | "slow"
): Array<{ name: string; value: string }> {
  return [{ name: fixtureModelCookieName(), value: mode }]
}

/**
 * Make the Canvas throw as it mounts, so the route's error boundary catches it.
 *
 * The fixture world can't make the server render fail on demand, but the route
 * has one boundary for the server render and the client Canvas alike, so any
 * throw inside it paints the same page. `ResizeObserver` is constructed by the
 * panel layout on mount and nowhere before the Canvas, so failing it reaches
 * exactly that boundary and nothing earlier.
 */
export async function breakCanvasMount(page: Page): Promise<void> {
  await page.addInitScript(`
    window.ResizeObserver = class {
      constructor() {
        throw new Error("screenshot harness: simulated Canvas failure")
      }
    }
  `)
}

/** Click the confirm dialog's action button. */
export async function confirmDialog(page: Page, verb: string): Promise<void> {
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: verb, exact: true })
    .click({ timeout: 10_000 })
}
