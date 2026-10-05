import type { Frame, Page } from "playwright-core"

import { AGENT_PARTY, frameControlKey } from "@/lib/canvas/frame-control"
import { LOCAL_USER_ID } from "@/lib/local-user"
import { stubLogs, stubTerminal } from "../fixtures/streams"
import { settle } from "../lib/browser"
import {
  CREATE_WORKSPACES_TOOL,
  createdWorkspacesResult,
  workspaceLink,
} from "@/lib/agent/workspace-task"
import { roomChatId } from "@/lib/chat/room-chat"
import {
  canvasPanels,
  entryState,
  homeView,
  injectYjsUpdate,
  replayRun,
  text,
  type RunEvent,
  showTooltip,
  unfreeze,
  type Screen,
} from "../screens"
import { DOCS_CLOCK, DOCS_IDS, PROMPTS } from "./world"

/**
 * The **docs screen list** — every screenshot the product docs embed
 * (`<Screenshot name="…">` in `apps/docs/content`), in the docs world.
 *
 * Same shape as the design-review list (`../screens/`), plus a `crop`: a
 * detail screen names the region worth reading, in CSS px of the capture, and
 * `./frame.ts` magnifies it; a screen without one is framed as the whole
 * window. Every screen is shot at {@link DOCS_VIEWPORT}, the size the crops are
 * measured against.
 */
export interface DocsScreen extends Screen {
  /**
   * What a detail screen is *about* — a menu, a dialog, a popover — as
   * selectors. After `prepare`, the union of the visible matches is measured,
   * and `./frame.ts` crops a detail centred on it with room around it. So a
   * menu that moves in a UI change is still framed whole and centred, without
   * anyone re-measuring it.
   */
  focus?: readonly string[] | ((page: Page) => Promise<Crop | null>)
  /**
   * A fixed focus region, `[x, y, width, height]` in CSS px of the capture, for
   * a detail no selector pins down. Used when `focus` matches nothing.
   */
  crop?: Crop
  /**
   * Room left around the focus, in CSS px ({@link FOCUS_PAD} by default). A
   * dialog uses 0: the image is the dialog.
   */
  pad?: number
  /**
   * Leave a focused text field focused. Otherwise it's blurred before the
   * capture, so a detail doesn't show a focus ring and caret nobody put there.
   */
  keepFocus?: boolean
  /**
   * For a full-window screen of a page that opens in the user's browser
   * rather than the app (the prototype player): the address `./frame.ts`
   * shows in the browser window it draws around the capture.
   */
  browser?: string
}

export type Crop = [x: number, y: number, width: number, height: number]

/** Room left around a detail's focus by default (CSS px). */
export const FOCUS_PAD = 16

/** Focus regions measured during the last capture, by `<name>.<theme>`. */
export const measuredFocus = new Map<string, Crop>()

/** Screens whose `prepare` failed in the last capture, by `<name>.<theme>`. */
export const failedPrepares = new Map<string, string>()

// Focus presets: the open surface plus the control that opened it.
const MENU = ["[role=menu]", "button[data-state=open]"]
/** The topmost open dialog: a dialog opened over another is shot alone. */
async function DIALOG(page: Page): Promise<Crop | null> {
  const rect = (await page.evaluate(`(() => {
    const open = [...document.querySelectorAll("[role=dialog],[role=alertdialog]")]
      .map((e) => e.getBoundingClientRect())
      .filter((r) => r.width && r.height)
    const r = open[open.length - 1]
    return r ? [r.left, r.top, r.width, r.height] : null
  })()`)) as Crop | null
  return rect && (rect.map(Math.round) as Crop)
}
const POPOVER = ["[data-slot=popover-content]", "button[data-state=open]"]
/** The chat composer's editor (the canvas's documents are editors too). */
const COMPOSER = "[contenteditable=true][data-placeholder^='Ask the agent']"
/** A composer suggestion list (@ mentions, / skills), rendered by TipTap. */
const SUGGESTIONS = [".react-renderer", "[data-slot=composer]"]

/** The text selection in a document, and the formatting toolbar above it. */
async function selectionAndToolbar(page: Page): Promise<Crop | null> {
  const rect = (await page.evaluate(`(() => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null
    const r = sel.getRangeAt(0).getBoundingClientRect()
    let best = null
    for (const t of document.querySelectorAll("[data-slot=floating-toolbar]")) {
      const b = t.getBoundingClientRect()
      if (!b.width) continue
      const d = Math.abs(b.bottom - r.top)
      if (!best || d < best.d) best = { d, b }
    }
    const b = best ? best.b : r
    const x0 = Math.min(r.left, b.left), y0 = Math.min(r.top, b.top)
    return [x0, y0, Math.max(r.right, b.right) - x0, Math.max(r.bottom, b.bottom) - y0]
  })()`)) as Crop | null
  return rect && (rect.map(Math.round) as Crop)
}

export const DOCS_VIEWPORT = { width: 1280, height: 800 } as const
/** For a dialog or menu too tall for {@link DOCS_VIEWPORT} to show unscrolled. */
const TALL_VIEWPORT = { width: 1280, height: 1200 } as const

const ids = DOCS_IDS
const ROOM = `/${ids.rooms.northwind}`
const PLAY = `/play/${ids.rooms.northwind}/${ids.branches.hero}?route=/`
/** The player's address as the browser shows it (`openExternal` in `use-frame-actions.ts`). */
const PLAY_ADDRESS = `screenplay.example.com/play/${ids.rooms.northwind}/${ids.branches.hero}`

/**
 * Request play mode once before navigating to it: its first server render of
 * a canvas nobody has open 404s (#834), and each screen shoots from a fresh
 * browser, so every play screen would otherwise start on the not-found page.
 */
async function warmPlay(page: Page) {
  await page.request.get(PLAY)
}

/** Camera presets for the Northwind canvas (canvas-container px and zoom). */
const VIEW = {
  overview: { x: 48, y: 110, zoom: 0.262 },
  hero: { x: 16, y: 80, zoom: 0.31 },
  frameCloseUp: { x: 60, y: 96, zoom: 0.62 },
  emptyLeft: { x: 1000, y: 120, zoom: 0.62 },
  pricing: { x: 16, y: -250, zoom: 0.31 },
  document: { x: -1080, y: -600, zoom: 0.62 },
  /** Far enough left that the selection toolbar clears the chat panel. */
  documentEdit: { x: -1480, y: -700, zoom: 0.8 },
  /** The Homepage group's two frames, large enough to read. */
  result: { x: 40, y: 100, zoom: 0.5 },
  /** The pricing canvas's first mockup, beside its mobile frame. */
  mockupCloseUp: { x: -650, y: 150, zoom: 0.38 },
} as const

// Panel widths are percentages of the window: a 240px sidebar and a 420px chat.
const SIDEBAR_ONLY = canvasPanels({ sidebarPct: 18.75 })
const WITH_CHAT = canvasPanels({ sidebarPct: 18.75, chatPct: 32.8 })

/** A docs screen: the docs viewport, and a `focus` measured after `prepare`. */
const screen = (s: DocsScreen): DocsScreen => {
  // Freeze the browser clock on the docs world's instant, so relative times
  // and dates render identically on every run.
  const beforeNavigate = async (page: Page) => {
    await page.clock.setFixedTime(new Date(DOCS_CLOCK))
    // Present a windowed (not fullscreen) desktop app. Outside Tauri the app
    // decides whether the macOS traffic lights are showing by comparing the
    // window to the screen (`lib/use-traffic-lights.ts`), and a headless
    // browser's screen is exactly its viewport — which reads as fullscreen,
    // so the app would give up the space `./frame.ts` draws the lights in.
    await page.addInitScript({
      content: `Object.defineProperty(window.screen, "height", { get: () => window.innerHeight + 120 })`,
    })
    await s.beforeNavigate?.(page)
  }
  const prepare = async (page: Page) => {
    const key = `${s.name}.${await themeOf(page)}`
    try {
      await waitForLoaded(page)
      await s.prepare?.(page)
      if (!s.keepFocus) {
        await page.evaluate(
          `document.activeElement?.matches("input, textarea") && document.activeElement.blur()`
        )
      }
      if (s.focus) {
        await sleep(page, 300)
        const focus =
          typeof s.focus === "function"
            ? await s.focus(page)
            : await measureFocus(page, s.focus)
        if (focus) measuredFocus.set(key, focus)
      }
      failedPrepares.delete(key)
    } catch (err) {
      // The runner still captures the screen without its step; record it so
      // a strict run can refuse to publish that image.
      failedPrepares.set(
        key,
        err instanceof Error ? err.message.split("\n")[0]! : String(err)
      )
      throw err
    }
  }
  return { viewport: DOCS_VIEWPORT, ...s, beforeNavigate, prepare }
}

/**
 * Wait for the app's loading spinners (`Spinner` in `@workspace/ui`, a
 * `role=status` "Loading" icon) to clear. The runner's settle step waits for
 * skeletons, not spinners, so on a cold dev server a panel that fetches on
 * mount — Settings' coding agents and presets — would be shot mid-load. A
 * screen whose spinner never clears (a stream held open on purpose) is shot
 * after the timeout, as it is.
 */
async function waitForLoaded(page: Page) {
  await page
    .waitForFunction(
      `![...document.querySelectorAll("[role=status][aria-label=Loading]")].some((e) => e.getBoundingClientRect().width > 0)`,
      undefined,
      { timeout: 20_000 }
    )
    .catch(() => {})
}

async function themeOf(page: Page): Promise<string> {
  return (await page.evaluate(
    `document.documentElement.classList.contains("dark") ? "dark" : "light"`
  )) as string
}

/** The union of the visible elements matching `selectors`, clamped to the window. */
async function measureFocus(
  page: Page,
  selectors: readonly string[]
): Promise<Crop | null> {
  const rect = (await page.evaluate(
    `(() => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const el of document.querySelectorAll(${JSON.stringify(selectors.join(","))})) {
        const r = el.getBoundingClientRect()
        const style = getComputedStyle(el)
        if (!r.width || !r.height || style.visibility === "hidden" || style.opacity === "0") continue
        x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top)
        x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom)
      }
      return x0 === Infinity ? null : [x0, y0, x1, y1]
    })()`
  )) as [number, number, number, number] | null
  if (!rect) return null
  const { width: W, height: H } = page.viewportSize() ?? DOCS_VIEWPORT
  const x0 = Math.max(0, Math.floor(rect[0]))
  const y0 = Math.max(0, Math.floor(rect[1]))
  const x1 = Math.min(W, Math.ceil(rect[2]))
  const y1 = Math.min(H, Math.ceil(rect[3]))
  return [x0, y0, x1 - x0, y1 - y0]
}

/**
 * A focus measured in the page for a region rather than an open surface:
 * `subject` is page JS for its `[left, top, right, bottom]` (or null). It is
 * padded here and clipped to `within`, so the crop stops at the edge of the
 * page, panel or canvas it belongs to instead of slicing into the UI beside
 * it. Spread into a screen; it sets `pad: 0`, the padding being already in.
 */
function clipped(
  subject: string,
  options: { within?: string; insetTop?: number; pad?: number } = {}
): Pick<DocsScreen, "focus" | "pad"> {
  const pad = options.pad ?? FOCUS_PAD
  return {
    pad: 0,
    focus: async (page) => {
      const rect = (await page.evaluate(`(() => {
        const r = ${subject}
        if (!r) return null
        const box = ${options.within ? `document.querySelector(${JSON.stringify(options.within)})?.getBoundingClientRect()` : "null"}
        const b = box ?? { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
        const x0 = Math.max(r[0] - ${pad}, b.left, 0)
        const y0 = Math.max(r[1] - ${pad}, b.top + ${options.insetTop ?? 0}, 0)
        const x1 = Math.min(r[2] + ${pad}, b.right, innerWidth)
        const y1 = Math.min(r[3] + ${pad}, b.bottom, innerHeight)
        return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : null
      })()`)) as [number, number, number, number] | null
      if (!rect) return null
      const x0 = Math.ceil(rect[0])
      const y0 = Math.ceil(rect[1])
      return [x0, y0, Math.floor(rect[2]) - x0, Math.floor(rect[3]) - y0]
    },
  }
}

/** Page JS: the union of `selectors`' visible boxes, `growTop` taller. */
function unionOf(selectors: readonly string[], growTop = 0): string {
  return `(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const el of document.querySelectorAll(${JSON.stringify(selectors.join(","))})) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height || getComputedStyle(el).visibility === "hidden") continue
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top)
      x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom)
    }
    return x0 === Infinity ? null : [x0, y0 - ${growTop}, x1, y1]
  })()`
}

/**
 * Page JS: everything painted inside `root` (text, images, controls, and
 * anything with a border, background or shadow), so a page crops to what it
 * shows instead of the empty space below it.
 */
function paintedIn(root: string, band = "null"): string {
  return `(() => {
    const root = document.querySelector(${JSON.stringify(root)})
    if (!root) return null
    const R = root.getBoundingClientRect()
    const band = ${band} ?? [R.top, R.bottom]
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const el of root.querySelectorAll("*")) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height || r.top < band[0] || r.bottom > band[1]) continue
      // A container as big as the root paints its background everywhere.
      if (r.width * r.height > 0.5 * R.width * R.height) continue
      const s = getComputedStyle(el)
      if (s.visibility === "hidden" || s.opacity === "0") continue
      const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
      const painted = text ||
        /^(img|svg|canvas|iframe|input|textarea|button)$/i.test(el.tagName) ||
        s.backgroundColor !== "rgba(0, 0, 0, 0)" ||
        parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderBottomWidth) > 0 ||
        s.boxShadow !== "none"
      if (!painted) continue
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top)
      x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom)
    }
    return x0 === Infinity ? null : [x0, y0, x1, y1]
  })()`
}

/**
 * Page JS: the box around the first element in `root` whose text is `text`,
 * such as a card by its title: its `levels`-th bordered ancestor, or its
 * closest match of `closest`.
 */
function boxAround(
  root: string,
  text: string,
  { levels = 1, closest }: { levels?: number; closest?: string } = {}
): string {
  return `(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(root)} + " *")]
    let el = els.find((e) => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(text)})
    ${
      closest
        ? `el = el?.closest(${JSON.stringify(closest)})`
        : `for (let n = 0; el && n < ${levels}; n++) {
      el = el.parentElement
      while (el && parseFloat(getComputedStyle(el).borderTopWidth) === 0) el = el.parentElement
    }`
    }
    if (!el) return null
    const r = el.getBoundingClientRect()
    return [r.left, r.top, r.right, r.bottom]
  })()`
}

/**
 * Page JS: the chat panel's composer and the terminal pane under it, or the
 * Coordinator's empty state above it down to the composer.
 */
const CHAT_COMPOSER = "#chat [data-slot=composer]"
const CHAT_FOOT = `(() => {
  const chat = document.querySelector("#chat")?.getBoundingClientRect()
  const composer = document.querySelector(${JSON.stringify(CHAT_COMPOSER)})?.getBoundingClientRect()
  return chat && composer && chat.width ? [chat.left, composer.top, chat.right, chat.bottom] : null
})()`
const COORDINATOR_EMPTY = `(() => {
  const heading = [...document.querySelectorAll("#chat *")].find((e) => e.childElementCount === 0 && e.textContent.trim() === "Ask about this canvas")
  const composer = document.querySelector(${JSON.stringify(CHAT_COMPOSER)})?.getBoundingClientRect()
  const chat = document.querySelector("#chat")?.getBoundingClientRect()
  if (!heading || !composer || !chat) return null
  return [chat.left, heading.getBoundingClientRect().top, chat.right, chat.bottom]
})()`

/** Page JS: what the chat panel's transcript shows, under its header. */
const CHAT_TRANSCRIPT = paintedIn(
  "#chat",
  `[document.querySelector("#chat").getBoundingClientRect().top + 49, document.querySelector(${JSON.stringify(CHAT_COMPOSER)}).getBoundingClientRect().top]`
)

/** A home or Settings page's content, right of the sidebar. */
const HOME_CONTENT = clipped(paintedIn("#home-content main"), {
  within: "#home-content",
})
/** The selected layer's floating toolbar, under it. */
const FRAME_TOOLBAR = "#frame-toolbar-portal [role=toolbar]"
/** Room above a layer for its title line. */
const TITLE_LINE = 28
const layer = (id: string) => `[data-layer-id="${id}"]`
/** Layers on the canvas, clipped to it and kept below its top bar. */
const onCanvas = (selectors: readonly string[], pad?: number) =>
  clipped(unionOf(selectors, TITLE_LINE), {
    within: "#canvas",
    insetTop: 48,
    pad,
  })

/** A mockup's page, by its layer id, once its runtime has loaded. */
async function mockupPage(page: Page, id: string): Promise<Frame> {
  const iframe = page.locator(`${layer(id)} iframe`).first()
  await iframe.waitFor({ timeout: 15_000 })
  const frame = await (await iframe.elementHandle())!.contentFrame()
  if (!frame) throw new Error(`no page in mockup ${id}`)
  await frame.waitForFunction("!!window.screenplay?.draft", undefined, {
    timeout: 15_000,
  })
  return frame
}

/** Page JS: a decision page's bottom bar whose button drafts into the chat. */
const SEND_TO_CHAT_BAR = `(() => {
  const bar = document.createElement("div")
  bar.style.cssText = "position:fixed;inset:auto 0 0 0;display:flex;align-items:center;gap:16px;padding:16px 24px;background:#0f172a;color:#fff;font:600 18px system-ui"
  bar.innerHTML = '<span style="flex:1">Picked <b>A</b> · 1 note</span><button id="send-to-chat" style="font:inherit;padding:10px 18px;border:0;border-radius:10px;background:#fff;color:#0f172a">Send to chat</button>'
  document.body.append(bar)
  bar.querySelector("button").onclick = () =>
    screenplay.draft("Picked A. Note on B: the side-by-side cards feel cramped on a laptop.")
})()`

/** Collapse the chat panel, which selecting a layer can open over the canvas. */
async function hideChat(page: Page) {
  const hide = page.getByRole("button", { name: /^Hide chat/ }).first()
  if (await hide.isVisible().catch(() => false)) {
    await hide.click({ force: true, timeout: 5_000 })
    await page.mouse.move(0, 0)
    await sleep(page, 600)
  }
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const sleep = (page: Page, ms: number) => page.waitForTimeout(ms)

/** Move the canvas camera (see `window.__canvasCamera` in `use-canvas-camera.ts`). */
async function camera(
  page: Page,
  view: { x: number; y: number; zoom: number }
) {
  await page.waitForFunction("!!window.__canvasCamera", undefined, {
    timeout: 15_000,
  })
  await page.evaluate(
    `window.__canvasCamera.setTransform(${view.x}, ${view.y}, ${view.zoom})`
  )
  // Frames that just came into view mount and load their previews.
  await settle(page, { freeze: false })
}

/** Centre of the first element matching `selector` whose text satisfies `match`. */
async function centerOf(
  page: Page,
  selector: string,
  match: string | null = null,
  within?: { minX?: number; maxX?: number; maxY?: number }
): Promise<{ x: number; y: number }> {
  const found = await page.evaluate(
    `(() => {
      const match = ${JSON.stringify(match)}
      const within = ${JSON.stringify(within ?? {})}
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => {
        const r = e.getBoundingClientRect()
        if (!r.width || !r.height) return false
        if (within.minX != null && r.x < within.minX) return false
        if (within.maxX != null && r.x > within.maxX) return false
        if (within.maxY != null && r.y > within.maxY) return false
        const text = (e.innerText || e.textContent || "").trim()
        return match === null || text === match || text.startsWith(match)
      })
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`
  )
  if (!found) throw new Error(`nothing matches ${selector} ${match ?? ""}`)
  return found as { x: number; y: number }
}

async function clickAt(page: Page, at: { x: number; y: number }, wait = 800) {
  await page.mouse.move(at.x, at.y)
  await sleep(page, 150)
  await page.mouse.click(at.x, at.y)
  await sleep(page, wait)
}

async function clickMenuItem(page: Page, name: string, wait = 800) {
  await page.getByRole("menuitem", { name }).first().click({ timeout: 10_000 })
  await sleep(page, wait)
}

/** Open Canvas settings from the canvas name's ⋯ menu. */
async function openCanvasSettings(page: Page) {
  await page.getByRole("button", { name: "Canvas options" }).click()
  await clickMenuItem(page, "Settings", 1200)
}

/** Open Canvas settings' New repository menu (#884, #1423). */
async function openAddRepositoryMenu(page: Page) {
  await openCanvasSettings(page)
  await page
    .getByRole("dialog", { name: "Canvas settings" })
    .getByRole("button", { name: "New repository" })
    .click({ timeout: 10_000 })
  await sleep(page, 900)
}

async function hoverMenuItem(page: Page, name: string) {
  await page.getByRole("menuitem", { name }).first().hover({ timeout: 10_000 })
  await sleep(page, 900)
}

/** Hover a home card, then open its ⋯ menu. */
async function openCardMenu(page: Page, name: string, label: string) {
  const at = (await page.evaluate(
    `(() => {
      const leaf = [...document.querySelectorAll("main *")].find(
        (e) => e.childElementCount === 0 && e.textContent.trim() === ${JSON.stringify(name)}
      )
      let card = leaf
      while (card && !card.querySelector(${JSON.stringify(`button[aria-label='${label}']`)})) card = card.parentElement
      if (!card) return null
      const r = card.getBoundingClientRect()
      const b = card.querySelector(${JSON.stringify(`button[aria-label='${label}']`)}).getBoundingClientRect()
      return { card: { x: r.x + r.width / 2, y: r.y + r.height / 2 }, button: { x: b.x + b.width / 2, y: b.y + b.height / 2 } }
    })()`
  )) as {
    card: { x: number; y: number }
    button: { x: number; y: number }
  } | null
  if (!at) throw new Error(`no card "${name}"`)
  await page.mouse.move(at.card.x, at.card.y)
  await sleep(page, 400)
  await clickAt(page, at.button, 900)
}

/** A Workspace row in the chat panel's Chats menu (#1152). */
const BRANCH_ROW = "[data-chats-menu] [cmdk-item]"

/** Open the chat panel's Chats menu, unless it's open already. */
async function openChatsMenu(page: Page) {
  if (await page.locator("[data-chats-menu]").isVisible()) return
  // The button lives on the Coordinator header only (#1152).
  const crumb = page.getByRole("button", { name: "Coordinator", exact: true })
  if (await crumb.isVisible()) await crumb.click()
  await page
    .getByRole("button", { name: "Chats", exact: true })
    .click({ timeout: 15_000 })
  await page.locator("[data-chats-menu]").waitFor({ timeout: 10_000 })
  await sleep(page, 400)
}

/** Hover a row (a Workspace in the Chats menu by default) by its text. */
async function hoverRow(page: Page, text: string, rowSelector = BRANCH_ROW) {
  if (rowSelector === BRANCH_ROW) await openChatsMenu(page)
  const at = (await page.evaluate(
    `(() => {
      const row = [...document.querySelectorAll(${JSON.stringify(rowSelector)})].find((e) => e.innerText.includes(${JSON.stringify(text)}))
      if (!row) return null
      const r = row.getBoundingClientRect()
      return { x: r.x + 60, y: r.y + r.height / 2 }
    })()`
  )) as { x: number; y: number } | null
  if (!at) throw new Error(`no row "${text}"`)
  await page.mouse.move(at.x, at.y)
  await sleep(page, 500)
}

/** Open a row's ⋯ menu. */
async function openRowMenu(page: Page, text: string, rowSelector = BRANCH_ROW) {
  await hoverRow(page, text, rowSelector)
  const at = (await page.evaluate(
    `(() => {
      const row = [...document.querySelectorAll(${JSON.stringify(rowSelector)})].find((e) => e.innerText.includes(${JSON.stringify(text)}))
      const btn = [...row.querySelectorAll("button")].find((b) => b.querySelector("svg.ph-dots-three"))
      if (!btn) return null
      const r = btn.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`
  )) as { x: number; y: number } | null
  if (!at) throw new Error(`no menu on row "${text}"`)
  await clickAt(page, at, 900)
}

/** Point the chat panel at a Workspace from the Chats menu. */
async function selectWorkspace(page: Page, text: string) {
  await openChatsMenu(page)
  const at = (await page.evaluate(
    `(() => {
      const row = [...document.querySelectorAll(${JSON.stringify(BRANCH_ROW)})].find((e) => e.innerText.includes(${JSON.stringify(text)}))
      if (!row) return null
      const r = row.getBoundingClientRect()
      return { x: r.x + 40, y: r.y + r.height / 2 }
    })()`
  )) as { x: number; y: number } | null
  if (!at) throw new Error(`no Workspace "${text}"`)
  await clickAt(page, at, 1500)
  await settle(page, { freeze: false })
}

/** Select a frame or document by clicking its title on the canvas. */
async function selectLayer(page: Page, title: string) {
  await clickAt(
    page,
    await centerOf(page, "span,div", title, { minX: 250 }),
    900
  )
}

const HERO_TITLE = "Hero gradient & trust line"

/**
 * The Quickstart's first ask, as the Coordinator answers it: it starts the
 * hero Workspace (`create_workspaces`, which the panel draws as a card) and
 * says so. Replayed rather than seeded, so every other screen keeps the
 * Coordinator's empty state.
 */
function firstAskRun(): RunEvent[] {
  const workspace = {
    title: HERO_TITLE,
    repository: "northwind-web",
    prompt: PROMPTS.hero,
  }
  return [
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "user_message_chunk",
        content: text(PROMPTS.hero),
      },
    },
    { type: "chat-stream-start" },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "docs-first-ask-create",
        title: CREATE_WORKSPACES_TOOL,
        kind: "other",
        status: "completed",
        rawInput: { workspaces: [workspace] },
        content: [
          {
            type: "content",
            content: text(
              createdWorkspacesResult([
                { ...workspace, branchId: ids.branches.hero },
              ])
            ),
          },
        ],
      },
    },
    {
      type: "chat-acp-update",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: text(
          `I started ${workspaceLink(HERO_TITLE, ids.branches.hero)} for this. Its frame updates as the agent works; click the card to follow along.`
        ),
      },
    },
    { type: "chat-stream-end" },
  ]
}

/** The agent drives the Home frame in this viewer's copy (#1387). */
async function claudeDrivesHome(page: Page) {
  await injectYjsUpdate(page, (c) =>
    c.frameControl.set(frameControlKey(ids.layers.home, LOCAL_USER_ID), {
      live: false,
      driver: AGENT_PARTY,
      requests: [],
    })
  )
}

/** The pricing canvas's first mockup, "Option A · Toggle". */
const TOGGLE_MOCKUP = "mockup-annual-pricing-test-0"

/** The agent drives the Toggle mockup in this viewer's copy (#1391). */
async function claudeDrivesToggleMockup(page: Page) {
  await injectYjsUpdate(page, (c) =>
    c.frameControl.set(frameControlKey(TOGGLE_MOCKUP, LOCAL_USER_ID), {
      live: false,
      driver: AGENT_PARTY,
      requests: [],
    })
  )
}

/**
 * You drive the Home frame and Ana and Ben ask for control (#1395). The record
 * is marked live, as a shared frame's is, so your seat is picked back up on
 * load: Interact on, and the request popover under the driver button.
 */
async function othersAskForHome(page: Page) {
  await injectYjsUpdate(
    page,
    (c) =>
      c.frameControl.set(frameControlKey(ids.layers.home, LOCAL_USER_ID), {
        live: true,
        driver: LOCAL_USER_ID,
        requests: [
          { by: "user-ana", at: 1 },
          { by: "user-ben", at: 2 },
        ],
      }),
    [
      { id: "user-ana", name: "Ana", color: "#FFB74D" },
      { id: "user-ben", name: "Ben", color: "#4DD0E1" },
    ]
  )
}

/** The selected frame's floating toolbar button, by its label. */
const frameToolbar = (label: string) =>
  `button[data-size='icon-sm'][aria-label='${label}']`

async function clickFrameToolbar(page: Page, label: string, wait = 900) {
  const at = await centerOf(page, frameToolbar(label), null, { minX: 250 })
  await clickAt(page, at, wait)
}

/** Click into the chat composer. */
async function focusComposer(page: Page) {
  const at = (await page.evaluate(
    `(() => {
      const r = [...document.querySelectorAll("[contenteditable=true]")]
        .map((e) => e.getBoundingClientRect())
        .filter((r) => r.x > 800 && r.width)
        .pop()
      return r ? { x: r.x + 60, y: r.y + 10 } : null
    })()`
  )) as { x: number; y: number } | null
  if (!at) throw new Error("no composer")
  await clickAt(page, at, 300)
}

/** The widest preview iframe showing `pathname` (the desktop frame). */
async function previewFrame(page: Page, pathname: string) {
  let best:
    | {
        frame: import("playwright-core").Frame
        box: { x: number; y: number; width: number; height: number }
      }
    | undefined
  for (const frame of page.frames()) {
    if (frame === page.mainFrame()) continue
    try {
      if (new URL(frame.url()).pathname !== pathname) continue
      const box = await (await frame.frameElement()).boundingBox()
      if (box && (!best || box.width > best.box.width)) best = { frame, box }
    } catch {
      /* a frame mid-navigation */
    }
  }
  if (!best) throw new Error(`no preview frame for ${pathname}`)
  return best
}

/** Scroll the docs world's plan card into view in the FAQ chat. */
async function scrollToPlan(page: Page) {
  await page.evaluate(`(() => {
    const el = [...document.querySelectorAll("*")].find(
      (e) => e.childElementCount === 0 && e.textContent.trim().startsWith("Add an FAQ section")
    )
    el && el.scrollIntoView({ block: "start" })
  })()`)
  await sleep(page, 800)
}

/**
 * Open a play-mode HUD surface: click its button until `ready` is visible.
 * The HUD paints before play mode has hydrated, so an early click can land
 * on a button with no handler yet and silently do nothing.
 */
async function openHud(page: Page, button: string, ready: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await clickAt(page, await playHudButton(page, button), 300)
    const opened = await page
      .locator(ready)
      .first()
      .waitFor({ state: "visible", timeout: 4_000 })
      .then(() => true)
      .catch(() => false)
    if (opened) {
      await sleep(page, 800) // let the entrance animation finish
      return
    }
  }
  throw new Error(`play HUD: ${button} never opened ${ready}`)
}

/** A play-mode HUD button, once the room has synced and the HUD is up. */
async function playHudButton(page: Page, selector: string) {
  await page.waitForSelector(selector, { state: "visible", timeout: 30_000 })
  return centerOf(page, selector)
}

// ---------------------------------------------------------------------------
// Stream samples: a Workspace's dev server, as its logs and a terminal see it
// ---------------------------------------------------------------------------

const ESC = "\x1b["
const sgr = (codes: string, text: string) => `${ESC}${codes}m${text}${ESC}0m`

const TERMINAL_SAMPLE = [
  `${sgr("32", "~/customer-stories")} ${sgr("1", "$")} git status -sb`,
  `## customer-stories...origin/customer-stories`,
  `${sgr("32", "~/customer-stories")} ${sgr("1", "$")} npm run build`,
  "",
  `> northwind-web@0.0.0 build`,
  `> vite build`,
  "",
  `${sgr("36", "vite v7.1.3")} ${sgr("32", "building for production...")}`,
  `${sgr("32", "✓")} 42 modules transformed.`,
  `${sgr("90", "dist/")}index.html                 ${sgr("1;90", "0.46 kB")}`,
  `${sgr("90", "dist/")}${sgr("35", "assets/index-C3k9aQ1x.css")}  ${sgr("1;90", "4.71 kB")}`,
  `${sgr("90", "dist/")}${sgr("36", "assets/index-DpW2nB7e.js")}   ${sgr("1;90", "198.12 kB")}`,
  `${sgr("32", "✓ built in 812ms")}`,
  `${sgr("32", "~/customer-stories")} ${sgr("1", "$")} `,
].join("\r\n")

const LOGS_SAMPLE =
  [
    `${sgr("90", "10:42:07")} ${sgr("36", "[setup]")} ${sgr("1", "npm install")}`,
    `${sgr("90", "10:42:19")} ${sgr("36", "[setup]")} added 64 packages in 11s`,
    `${sgr("90", "10:42:19")} ${sgr("36", "[dev]")} ${sgr("1", "npm run dev -- --port 5174")}`,
    `${sgr("90", "10:42:20")} ${sgr("36", "[dev]")}   ${sgr("32", "VITE v7.1.3")}  ready in ${sgr("1", "412 ms")}`,
    `${sgr("90", "10:42:20")} ${sgr("36", "[dev]")}   ${sgr("32", "➜")}  ${sgr("1", "Local:")}   ${sgr("36", "http://localhost:5174/")}`,
    `${sgr("90", "10:43:02")} ${sgr("36", "[dev]")} ${sgr("90", "10:43:02 AM")} ${sgr("36", "[vite]")} ${sgr("32", "hmr update")} ${sgr("90", "/src/pages/Home.jsx")}`,
    `${sgr("90", "10:43:05")} ${sgr("36", "[dev]")} ${sgr("90", "10:43:05 AM")} ${sgr("36", "[vite]")} ${sgr("32", "hmr update")} ${sgr("90", "/src/styles.css")}`,
  ].join("\n") + "\n"

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export const DOCS_SCREENS: DocsScreen[] = [
  // --- Home -----------------------------------------------------------------
  screen({
    name: "home-recents",
    description: "Home → Recents.",
    path: "/",
    ...HOME_CONTENT,
  }),
  screen({
    name: "home-all-files",
    ...HOME_CONTENT,
    description: "Home → All files.",
    path: "/files",
  }),
  screen({
    name: "home-canvas-menu",
    description: "A Canvas card's ⋯ menu.",
    path: "/files",
    crop: [280, 120, 640, 480],
    focus: MENU,
    prepare: (page) =>
      openCardMenu(page, "Northwind marketing site", "Canvas actions"),
  }),
  screen({
    name: "home-folder-menu",
    description: "A Folder card's ⋯ menu.",
    path: "/files",
    crop: [560, 60, 620, 300],
    focus: MENU,
    prepare: (page) => openCardMenu(page, "Marketing", "Folder actions"),
  }),
  screen({
    name: "home-search",
    description: "Home search's results popover under the sidebar field.",
    path: "/files",
    focus: ["[data-slot=popover-content]", "[data-slot=sidebar-input]"],
    prepare: async (page) => {
      const field = page.getByLabel("Search canvases and folders")
      await field.click({ timeout: 15_000 })
      await field.pressSequentially("north")
      await page
        .locator("[data-slot=popover-content]")
        .waitFor({ timeout: 5_000 })
      await sleep(page, 400)
    },
  }),
  screen({
    name: "home-table",
    ...HOME_CONTENT,
    description: "The home grid in its table layout.",
    path: "/files",
    cookies: homeView("table"),
  }),
  screen({
    name: "home-folder",
    ...HOME_CONTENT,
    description: "Inside the Marketing folder.",
    path: `/files/${ids.folders.marketing}`,
  }),

  // --- Settings -------------------------------------------------------------
  screen({
    name: "settings",
    ...HOME_CONTENT,
    description: "Settings, top.",
    path: "/settings",
  }),
  screen({
    name: "settings-coding-agents",
    ...HOME_CONTENT,
    description: "Settings → Agent.",
    path: "/settings?section=coding-agents",
  }),
  screen({
    name: "settings-presets",
    ...HOME_CONTENT,
    description: "Settings → Repositories.",
    path: "/settings?section=repositories",
  }),
  screen({
    name: "settings-memory",
    ...HOME_CONTENT,
    description: "Settings → Memory: your account memory.",
    path: "/settings?section=memory",
    prepare: async (page) => {
      await page.getByText("Saved by agent").first().waitFor()
    },
  }),
  screen({
    name: "settings-files",
    ...HOME_CONTENT,
    description: "Settings → Files: your account files, one folder expanded.",
    path: "/settings?section=files",
    prepare: async (page) => {
      await page.getByRole("button", { name: /^writing/ }).click()
      await page.getByText("voice-and-tone.md").waitFor()
      // Off the row, so its ⋯ doesn't cover the item count.
      await page.mouse.move(0, 0)
    },
  }),
  screen({
    name: "settings-skills",
    ...HOME_CONTENT,
    description: "Settings → Skills: your account skills.",
    path: "/settings?section=skills",
    prepare: async (page) => {
      await page.getByText("release-notes").waitFor()
    },
  }),
  screen({
    name: "preset-form",
    focus: DIALOG,
    pad: 0,
    description: "Editing a repository in Settings.",
    path: "/settings?section=repositories",
    prepare: async (page) => {
      await page.getByRole("button", { name: "Edit" }).first().click()
      await sleep(page, 1200)
    },
  }),
  screen({
    name: "setup-gate",
    description: "The first-run setup gate, with Claude Code ready.",
    path: "/",
    cookies: entryState("setup-agent-ready"),
    // The setup stepper is a small card in an otherwise empty window.
    ...clipped(paintedIn("body")),
  }),

  // --- Canvas and sidebar ---------------------------------------------------
  screen({
    name: "hero",
    description: "The Northwind canvas with the hero Workspace's chat open.",
    path: ROOM,
    cookies: WITH_CHAT,
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await selectWorkspace(page, "Hero gradient")
    },
  }),
  screen({
    name: "coordinator",
    ...clipped(COORDINATOR_EMPTY, { within: "#chat" }),
    description:
      "The chat panel's home: the canvas's Coordinator chat, with no Workspace selected.",
    path: ROOM,
    cookies: WITH_CHAT,
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
    },
  }),
  screen({
    name: "quickstart-coordinator",
    description:
      "The Quickstart's ask in the Coordinator: the workspace it started, as a card.",
    path: ROOM,
    cookies: WITH_CHAT,
    ...clipped(CHAT_TRANSCRIPT, { within: "#chat", insetTop: 49 }),
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await page
        .getByText("Ask about this canvas")
        .first()
        .waitFor({ timeout: 30_000 })
      await replayRun(page, roomChatId(ids.rooms.northwind), firstAskRun())
      await page
        .getByText(HERO_TITLE, { exact: true })
        .last()
        .waitFor({ timeout: 10_000 })
      await sleep(page, 600)
    },
  }),
  screen({
    name: "quickstart-result",
    description:
      "The Quickstart's finished change: the hero Workspace's frames with the gradient headline.",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    ...onCanvas([layer(ids.layers.home), layer(ids.layers.homeMobile)]),
    prepare: async (page) => {
      await hideChat(page)
      await camera(page, VIEW.result)
    },
  }),
  screen({
    name: "canvas-overview",
    description: "The whole Northwind canvas.",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    prepare: (page) => camera(page, VIEW.overview),
  }),
  screen({
    name: "canvas-mockups",
    ...onCanvas(["[data-layer-id]"]),
    description:
      "A pricing mockup beside the live mobile page, on the Pricing experiments canvas.",
    path: `/${ids.rooms.pricingExperiments}`,
    cookies: SIDEBAR_ONLY,
    // The mobile frame, then the first mockup after it in the Group.
    prepare: async (page) => {
      await hideChat(page)
      await camera(page, { x: -378, y: 130, zoom: 0.3 })
    },
  }),
  screen({
    name: "mockup-claude-driving",
    description: "A mockup the agent drives, not selected: its tag and ring.",
    path: `/${ids.rooms.pricingExperiments}`,
    cookies: SIDEBAR_ONLY,
    ...onCanvas([layer(TOGGLE_MOCKUP)], 16),
    beforeNavigate: claudeDrivesToggleMockup,
    prepare: async (page) => {
      await hideChat(page)
      await camera(page, VIEW.mockupCloseUp)
    },
  }),
  screen({
    name: "mockup-claude-driving-selected",
    ...onCanvas([layer(TOGGLE_MOCKUP), FRAME_TOOLBAR], 16),
    description: "A selected mockup the agent drives: its mark on Interact.",
    path: `/${ids.rooms.pricingExperiments}`,
    cookies: SIDEBAR_ONLY,
    beforeNavigate: claudeDrivesToggleMockup,
    prepare: async (page) => {
      await camera(page, VIEW.mockupCloseUp)
      await selectLayer(page, "Option A · Toggle")
      await hideChat(page)
    },
  }),
  screen({
    name: "mockup-draft",
    description:
      "A mockup page's Send to chat button, drafted into its chat's composer under a From row (#1645).",
    path: `/${ids.rooms.pricingExperiments}`,
    cookies: WITH_CHAT,
    prepare: async (page) => {
      await camera(page, { x: -660, y: 90, zoom: 0.4 })
      await page
        .locator(layer(TOGGLE_MOCKUP))
        .click({ position: { x: 240, y: 200 } })
      await page
        .locator(FRAME_TOOLBAR)
        .getByRole("button", { name: "Interact", exact: true })
        .click()
      await sleep(page, 600)
      const frame = await mockupPage(page, TOGGLE_MOCKUP)
      // The page's own bar, as a decision page draws it.
      await frame.evaluate(SEND_TO_CHAT_BAR)
      await frame.locator("#send-to-chat").click()
      await page.mouse.move(0, 0)
      await sleep(page, 1200)
    },
  }),
  screen({
    name: "canvas-menu",
    description: "The Canvas breadcrumb's ⋯ menu.",
    path: ROOM,
    cookies: WITH_CHAT,
    crop: [0, 0, 640, 300],
    focus: MENU,
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      const at = await centerOf(page, "button:has(svg.ph-dots-three)", null, {
        minX: 250,
        maxX: 700,
        maxY: 40,
      })
      await clickAt(page, at)
    },
  }),
  screen({
    name: "canvas-settings",
    description:
      "Canvas settings on Repositories, from the canvas name's ⋯ menu.",
    path: ROOM,
    cookies: WITH_CHAT,
    focus: DIALOG,
    pad: 0,
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await page.getByRole("button", { name: "Canvas options" }).click()
      await clickMenuItem(page, "Settings", 1200)
    },
  }),
  screen({
    name: "canvas-settings-memory",
    description:
      "Canvas settings on Memory: what every chat on the canvas reads.",
    path: ROOM,
    cookies: WITH_CHAT,
    focus: DIALOG,
    pad: 0,
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await page.getByRole("button", { name: "Canvas options" }).click()
      await clickMenuItem(page, "Settings", 1200)
      await page.getByRole("button", { name: "Memory" }).click()
      await page.getByText("Saved by agent").first().waitFor()
    },
  }),
  screen({
    name: "canvas-settings-files",
    description:
      "Canvas settings on Files: the files every chat on the canvas can open, one folder expanded.",
    path: ROOM,
    cookies: WITH_CHAT,
    focus: DIALOG,
    pad: 0,
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await page.getByRole("button", { name: "Canvas options" }).click()
      await clickMenuItem(page, "Settings", 1200)
      await page.getByRole("button", { name: "Files", exact: true }).click()
      await page.getByRole("button", { name: /^research/ }).click()
    },
  }),
  screen({
    name: "add-project-menu",
    description: "Canvas settings' New repository menu.",
    path: ROOM,
    cookies: WITH_CHAT,
    focus: MENU,
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await openAddRepositoryMenu(page)
    },
  }),
  screen({
    name: "configure-project",
    viewport: TALL_VIEWPORT,
    description: "Configure repository, after picking the demo checkout.",
    path: ROOM,
    cookies: WITH_CHAT,
    focus: DIALOG,
    pad: 0,
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await unfreeze(page)
      await openAddRepositoryMenu(page)
      await clickMenuItem(page, "Open folder", 1500)
      const input = page.locator("[role=dialog] input").first()
      await input.fill(DEMO_CHECKOUT_PATH())
      await page
        .locator("[role=dialog] button")
        .filter({ hasText: /^Add$/ })
        .first()
        .click()
      await page.getByText("Configure repository").waitFor({ timeout: 15_000 })
      await page
        .getByText("Detecting settings")
        .waitFor({ state: "detached", timeout: 15_000 })
        .catch(() => {})
      await sleep(page, 800)
    },
  }),
  screen({
    name: "project-settings",
    viewport: TALL_VIEWPORT,
    description: "Edit repository.",
    path: ROOM,
    cookies: WITH_CHAT,
    focus: DIALOG,
    pad: 0,
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await unfreeze(page)
      await openCanvasSettings(page)
      await page
        .getByRole("button", { name: "Edit northwind-web" })
        .click({ timeout: 10_000 })
      await sleep(page, 1500)
    },
  }),
  screen({
    name: "ws-menu",
    description: "A Workspace row's ⋯ menu.",
    path: ROOM,
    cookies: WITH_CHAT,
    crop: [560, 0, 720, 520],
    // With the Chats menu it opened from, whole.
    focus: [...MENU, "[data-chats-menu]"],
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await openRowMenu(page, "Hero gradient")
    },
  }),
  screen({
    name: "ws-restart",
    description: "The Workspace menu's Restart submenu.",
    path: ROOM,
    cookies: WITH_CHAT,
    crop: [460, 0, 820, 520],
    focus: [...MENU, "[data-chats-menu]"],
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await openRowMenu(page, "Hero gradient")
      await hoverMenuItem(page, "Restart")
    },
  }),
  screen({
    name: "recreate-dialog",
    description: "Recreate from scratch, confirming.",
    path: ROOM,
    cookies: WITH_CHAT,
    focus: DIALOG,
    pad: 0,
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await unfreeze(page)
      await openRowMenu(page, "Hero gradient")
      await hoverMenuItem(page, "Restart")
      await clickMenuItem(page, "Recreate from scratch", 1200)
    },
  }),
  screen({
    name: "delete-branch-dialog",
    description: "Deleting a Workspace.",
    path: ROOM,
    cookies: WITH_CHAT,
    focus: DIALOG,
    pad: 0,
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await unfreeze(page)
      await openRowMenu(page, "Customer stories")
      await clickMenuItem(page, "Delete", 1200)
    },
  }),

  // --- Frames ---------------------------------------------------------------
  screen({
    name: "frame-selected",
    ...onCanvas([layer(ids.layers.home), FRAME_TOOLBAR]),
    description: "A selected frame, with its toolbar.",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    prepare: async (page) => {
      await camera(page, VIEW.frameCloseUp)
      await selectLayer(page, "Home")
      await hideChat(page)
    },
  }),
  screen({
    name: "frame-tooltip-interact",
    description: "The frame toolbar's Interact tooltip.",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    crop: [760, 40, 520, 340],
    focus: ["[data-slot=tooltip-content]", "button[aria-label=Interact]"],
    prepare: async (page) => {
      await camera(page, VIEW.frameCloseUp)
      await selectLayer(page, "Home")
      await page.mouse.move(
        ...xy(await centerOf(page, frameToolbar("Interact")))
      )
      await showTooltip(page)
    },
  }),
  screen({
    name: "frame-claude-driving",
    description: "A frame the agent drives, not selected: its tag and ring.",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    ...onCanvas([layer(ids.layers.home)]),
    beforeNavigate: claudeDrivesHome,
    prepare: async (page) => {
      await hideChat(page)
      await camera(page, VIEW.frameCloseUp)
    },
  }),
  screen({
    name: "frame-claude-driving-selected",
    ...onCanvas([layer(ids.layers.home), FRAME_TOOLBAR]),
    description: "A selected frame the agent drives: its mark on Interact.",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    beforeNavigate: claudeDrivesHome,
    prepare: async (page) => {
      await camera(page, VIEW.frameCloseUp)
      await selectLayer(page, "Home")
      await hideChat(page)
    },
  }),
  screen({
    name: "frame-tooltip-take-over",
    description:
      "The driver button's take-over tooltip while the agent drives.",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    crop: [760, 40, 520, 340],
    focus: [
      "[data-slot=tooltip-content]",
      "button[aria-label='Agent has control']",
    ],
    beforeNavigate: claudeDrivesHome,
    prepare: async (page) => {
      await camera(page, VIEW.frameCloseUp)
      await selectLayer(page, "Home")
      await page.mouse.move(
        ...xy(await centerOf(page, frameToolbar("Agent has control")))
      )
      await showTooltip(page)
    },
  }),
  screen({
    name: "frame-control-requests",
    description:
      "The driver's popover when two people ask for control of a frame.",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    crop: [560, 40, 720, 460],
    focus: ["[data-slot=popover-content]", "button[aria-label=Interact]"],
    beforeNavigate: othersAskForHome,
    prepare: async (page) => {
      await camera(page, VIEW.frameCloseUp)
      await page
        .locator("[data-frame-control-request]")
        .first()
        .waitFor({ timeout: 15_000 })
    },
  }),
  screen({
    name: "frame-more-menu",
    description: "The frame toolbar's ⋯ menu.",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    crop: [560, 60, 640, 420],
    focus: MENU,
    prepare: async (page) => {
      await camera(page, VIEW.frameCloseUp)
      await selectLayer(page, "Home")
      await clickFrameToolbar(page, "Frame options")
    },
  }),
  screen({
    name: "device-size-menu",
    viewport: TALL_VIEWPORT,
    description: "The frame menu's Device size submenu.",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    crop: [560, 40, 640, 440],
    // The open submenu alone: around both menus, the crop would slice the
    // frames behind them.
    ...clipped(boxAround("body", "iPhone 17 Pro", { closest: "[role=menu]" }), {
      pad: 0,
    }),
    prepare: async (page) => {
      await camera(page, VIEW.frameCloseUp)
      await selectLayer(page, "Home")
      await clickFrameToolbar(page, "Frame options")
      await hoverMenuItem(page, "Device size")
    },
  }),
  screen({
    name: "knobs-popover",
    description: "The Knobs popover for the Home frame.",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    crop: [560, 60, 620, 460],
    focus: POPOVER,
    prepare: async (page) => {
      await camera(page, VIEW.frameCloseUp)
      await selectLayer(page, "Home")
      await clickFrameToolbar(page, "Knobs", 1500)
    },
  }),
  screen({
    name: "route-picker",
    description: "A frame's route edited in place, with its suggestions.",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    crop: [250, 40, 560, 340],
    focus: POPOVER,
    prepare: async (page) => {
      await camera(page, VIEW.frameCloseUp)
      await selectLayer(page, "Home")
      await clickAt(
        page,
        await centerOf(page, "button[aria-label^='Route: ']"),
        900
      )
    },
  }),
  screen({
    name: "frame-branch-picker",
    description: "A frame's Workspace picker.",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    crop: [250, 40, 560, 340],
    focus: POPOVER,
    prepare: async (page) => {
      await camera(page, VIEW.frameCloseUp)
      await selectLayer(page, "Home")
      // The Group names the Workspace, so the frame's own chooser shows on
      // hovering its name (#1276).
      const name = await centerOf(page, "span,div", "Home", { minX: 250 })
      await page.mouse.move(name.x, name.y)
      await clickAt(
        page,
        await centerOf(page, "button[aria-label='Choose chat']"),
        900
      )
    },
  }),
  screen({
    name: "frame-tool",
    focus: ["[role=toolbar][aria-label=Tools]"],
    pad: 0,
    description: "The Frame tool, about to draw.",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    prepare: async (page) => {
      await camera(page, VIEW.frameCloseUp)
      await page.keyboard.press("f")
      await page.mouse.move(640, 700)
      await sleep(page, 400)
    },
  }),

  // --- Agent panel ------------------------------------------------------------
  screen({
    name: "workspaces-menu",
    description:
      "The chat panel's Chats menu (#1152, #1317): the Coordinator, then every chat.",
    path: ROOM,
    cookies: WITH_CHAT,
    crop: [700, 0, 580, 460],
    ...clipped(unionOf([...POPOVER, "[data-chats-menu]"]), { within: "#chat" }),
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await openChatsMenu(page)
    },
  }),
  screen({
    name: "terminal-footnote",
    description:
      "A Workspace's chat with its terminals named in the footnote under the composer.",
    path: ROOM,
    cookies: WITH_CHAT,
    ...clipped(CHAT_FOOT, { within: "#chat", pad: 0 }),
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await selectWorkspace(page, "Hero gradient")
      await page.mouse.move(0, 0)
    },
  }),
  screen({
    name: "composer-mention",
    description: "The composer's @ mention menu.",
    path: ROOM,
    focus: SUGGESTIONS,
    cookies: WITH_CHAT,
    crop: [850, 480, 430, 320],
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await selectWorkspace(page, "Hero gradient")
      await focusComposer(page)
      await page.keyboard.type("Match the headline style on ", { delay: 5 })
      await page.keyboard.type("@")
      await sleep(page, 1200)
    },
  }),
  screen({
    name: "composer-skills",
    description: "The composer's / skills menu.",
    path: ROOM,
    focus: SUGGESTIONS,
    cookies: WITH_CHAT,
    crop: [860, 440, 420, 360],
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await selectWorkspace(page, "Hero gradient")
      await focusComposer(page)
      await page.keyboard.type("/")
      await sleep(page, 1500)
    },
  }),
  screen({
    name: "target-picking",
    ...clipped(unionOf(["#canvas"]), { pad: 0 }),
    description: "Element targeting: hovering a button in the Home frame.",
    path: ROOM,
    cookies: WITH_CHAT,
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await selectWorkspace(page, "Hero gradient")
      await focusComposer(page)
      await page.keyboard.type("Make ", { delay: 5 })
      await pointAtStartTrial(page, false)
    },
  }),
  screen({
    name: "composer-element-hover",
    description: "A targeted element in the composer, hovered.",
    path: ROOM,
    focus: ["[data-slot=hover-card-content]", "[data-slot=composer]"],
    cookies: WITH_CHAT,
    crop: [850, 480, 430, 320],
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await selectWorkspace(page, "Hero gradient")
      await focusComposer(page)
      await page.keyboard.type("Make ", { delay: 5 })
      await pointAtStartTrial(page, true)
      await page.keyboard.type("bigger and add an arrow icon after the label", {
        delay: 8,
      })
      await sleep(page, 600)
      const token = page
        .locator(
          "[data-type='element-token'], span[data-element-token], .element-token"
        )
        .first()
      if (await token.count()) {
        await token.hover()
        await sleep(page, 1000)
      }
    },
  }),
  screen({
    name: "logs",
    ...clipped(CHAT_FOOT, { within: "#chat", pad: 0 }),
    description:
      "The Terminal Pane open on Dev server, the dev server's output.",
    path: ROOM,
    cookies: WITH_CHAT,
    beforeNavigate: (page) => stubLogs(page, "live", LOGS_SAMPLE),
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await selectWorkspace(page, "Hero gradient")
      await page
        .getByRole("tablist", { name: "Terminals" })
        .getByRole("tab", { name: "Dev server" })
        .click()
      await sleep(page, 2500)
    },
  }),
  screen({
    name: "plan-card",
    // Tight, so the transcript around the card isn't sliced mid-line.
    ...clipped(
      boxAround("#chat", "Add an FAQ to the pricing page", { levels: 2 }),
      {
        within: "#chat",
        pad: 8,
      }
    ),
    description: "The approved plan in the Pricing FAQ chat.",
    path: ROOM,
    cookies: WITH_CHAT,
    prepare: async (page) => {
      await camera(page, VIEW.pricing)
      await selectWorkspace(page, "Pricing FAQ")
      await scrollToPlan(page)
    },
  }),
  screen({
    name: "doc-chat",
    ...onCanvas([layer(ids.layers.checklist)]),
    description:
      "The launch checklist document, with the name of the chat that wrote it (#1314), and that chat open.",
    path: ROOM,
    cookies: WITH_CHAT,
    prepare: async (page) => {
      // Low enough that the document's title line clears the top bar.
      await camera(page, { ...VIEW.document, y: VIEW.document.y + 40 })
      await selectWorkspace(page, "Pricing FAQ")
    },
  }),
  screen({
    name: "doc-selection-toolbar",
    description: "Editing the document: the selection toolbar.",
    path: ROOM,
    focus: selectionAndToolbar,
    cookies: SIDEBAR_ONLY,
    crop: [400, 150, 860, 480],
    prepare: async (page) => {
      await camera(page, VIEW.documentEdit)
      const line = await centerOf(page, "li p, li", "Annual toggle QA")
      const at = { x: line.x - 120, y: line.y }
      await page.mouse.click(at.x, at.y, { clickCount: 2 })
      await sleep(page, 1200)
      await page.mouse.click(at.x, at.y, { clickCount: 3 })
      await sleep(page, 1000)
    },
  }),
  screen({
    name: "doc-reply-in-chat",
    ...clipped(unionOf([CHAT_COMPOSER]), { within: "#chat", pad: 0 }),
    description: "A document passage quoted into the Coordinator's composer.",
    path: ROOM,
    cookies: WITH_CHAT,
    prepare: async (page) => {
      await camera(page, VIEW.documentEdit)
      const line = await centerOf(page, "li p, li", "Annual toggle QA")
      const at = { x: line.x - 120, y: line.y }
      await page.mouse.click(at.x, at.y, { clickCount: 2 })
      await sleep(page, 1200)
      await page.mouse.click(at.x, at.y, { clickCount: 3 })
      await sleep(page, 1000)
      await page.getByRole("button", { name: "Reply in chat" }).click()
      // The composer takes focus on the next frame.
      await sleep(page, 500)
      await page.keyboard.type("Is this still blocking the launch?")
      await page.mouse.move(0, 0)
      await sleep(page, 800)
    },
  }),
  screen({
    name: "terminal",
    ...clipped(CHAT_FOOT, { within: "#chat", pad: 0 }),
    description: "A terminal open in a Workspace's Terminal Pane.",
    path: ROOM,
    cookies: WITH_CHAT,
    beforeNavigate: (page) => stubTerminal(page, TERMINAL_SAMPLE),
    prepare: async (page) => {
      await camera(page, VIEW.hero)
      await selectWorkspace(page, "Customer stories")
      await page
        .getByRole("tablist", { name: "Terminals" })
        .getByRole("tab", { name: "Dev server" })
        .click()
      await page
        .getByRole("button", { name: "New terminal", exact: true })
        .first()
        .click()
      await page.mouse.move(0, 0)
      await sleep(page, 2500)
    },
  }),

  // --- Play mode --------------------------------------------------------------
  screen({
    name: "play-desktop",
    browser: PLAY_ADDRESS,
    description: "Play mode, desktop.",
    path: PLAY,
    beforeNavigate: warmPlay,
  }),
  screen({
    name: "play-hud",
    description: "Play mode's HUD, hovered.",
    path: PLAY,
    focus: [
      "[data-slot=tooltip-content]",
      "button[aria-label^='Device']",
      "button[aria-label='Show chat']",
    ],
    beforeNavigate: warmPlay,
    crop: [760, 440, 520, 360],
    prepare: async (page) => {
      const knobs = "button:has(svg.ph-sliders-horizontal)"
      // The HUD can still sit at the preview's top-left before it snaps to its
      // bottom-right corner; hovering then shot it in the wrong corner on some
      // runs.
      await page
        .waitForFunction(
          `(() => {
            const r = document.querySelector(${JSON.stringify(knobs)})?.getBoundingClientRect()
            return !!r && r.left > innerWidth / 2 && r.top > innerHeight / 2
          })()`,
          undefined,
          { timeout: 10_000 }
        )
        .catch(() => {})
      await page.mouse.move(...xy(await playHudButton(page, knobs)))
      await sleep(page, 900)
    },
  }),
  screen({
    name: "play-knobs",
    description: "Play mode's Knobs panel.",
    path: PLAY,
    beforeNavigate: warmPlay,
    crop: [700, 300, 580, 500],
    // The HUD's panel, which has no slot of its own, and the HUD under it.
    ...clipped(`(() => {
      const label = [...document.querySelectorAll("body *")].find((e) => e.childElementCount === 0 && e.textContent.trim() === "Accent color")
      const panel = label?.closest("[class*='outline-foreground']")?.getBoundingClientRect()
      const hud = document.querySelector("button:has(svg.ph-sliders-horizontal)")?.getBoundingClientRect()
      if (!panel) return null
      return hud
        ? [Math.min(panel.left, hud.left), Math.min(panel.top, hud.top), Math.max(panel.right, hud.right), Math.max(panel.bottom, hud.bottom)]
        : [panel.left, panel.top, panel.right, panel.bottom]
    })()`),
    prepare: async (page) => {
      await openHud(
        page,
        "button:has(svg.ph-sliders-horizontal)",
        "text=Accent color"
      )
    },
  }),
  screen({
    name: "play-agent",
    browser: PLAY_ADDRESS,
    description: "Play mode's agent panel.",
    path: PLAY,
    beforeNavigate: warmPlay,
    prepare: async (page) => {
      await openHud(page, "button:has(svg.ph-chats)", COMPOSER)
      await sleep(page, 1500) // the transcript loads after the panel opens
    },
  }),
  screen({
    name: "play-device-menu",
    description: "Play mode's device menu.",
    path: PLAY,
    beforeNavigate: warmPlay,
    crop: [760, 360, 520, 440],
    focus: ["[role=listbox]", "button[aria-label^='Device']"],
    prepare: async (page) => {
      await openHud(page, "button[aria-label^='Device']", "[role=option]")
    },
  }),
  screen({
    name: "play-mobile",
    browser: PLAY_ADDRESS,
    description: "Play mode on an iPhone 17 Pro.",
    path: PLAY,
    beforeNavigate: warmPlay,
    prepare: async (page) => {
      await unfreeze(page)
      await openHud(page, "button[aria-label^='Device']", "[role=option]")
      await page
        .locator("[role=option],[role=menuitem],[role=menuitemradio]")
        .filter({ hasText: /iPhone 17 Pro(?! Max)/ })
        .first()
        .click()
      await sleep(page, 3000)
      // The closed menu hands focus back to the Device button, whose tooltip
      // would otherwise sit over the stage.
      await page.evaluate("document.activeElement?.blur()")
      await page.mouse.move(640, 790)
      await sleep(page, 500)
    },
  }),
  screen({
    name: "frame-ask",
    description:
      "A frame drawn with the Frame tool asks what it should show (#1356).",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    crop: [300, 120, 440, 620],
    // Last in the list: drawing writes a frame to the room, which every later
    // screen would show. The dark pass first deletes the light pass's frame.
    prepare: async (page) => {
      // Empty canvas left of the Homepage group.
      await camera(page, VIEW.emptyLeft)
      await clickAt(page, { x: 540, y: 300 }, 300)
      await page.keyboard.press("Delete")
      await page.keyboard.press("f")
      // A phone-sized frame: 390 × 844 at 62%.
      await page.mouse.move(420, 160)
      await page.mouse.down()
      await page.mouse.move(500, 400, { steps: 8 })
      await page.mouse.move(662, 683, { steps: 8 })
      await page.mouse.up()
      // The card takes focus a frame after it opens.
      await sleep(page, 500)
      await page.keyboard.type("A mobile checkout with Apple Pay")
      await sleep(page, 600)
    },
  }),
  screen({
    name: "frame-ask-answerer",
    description:
      "With a frame selected, a drawn frame's ask goes to that frame's Workspace; the chip switches who answers (#1357).",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    crop: [300, 120, 440, 620],
    // After frame-ask, drawing in the same spot: each pass deletes the frame
    // the last one drew.
    prepare: async (page) => {
      await camera(page, VIEW.emptyLeft)
      await clickAt(page, { x: 540, y: 300 }, 300)
      await page.keyboard.press("Delete")
      // Select the Home frame from the sidebar, then draw beside it.
      await page.getByText("Home", { exact: true }).first().click()
      await sleep(page, 400)
      await camera(page, VIEW.emptyLeft)
      await page.keyboard.press("f")
      await page.mouse.move(420, 160)
      await page.mouse.down()
      await page.mouse.move(500, 400, { steps: 8 })
      await page.mouse.move(662, 683, { steps: 8 })
      await page.mouse.up()
      await sleep(page, 500)
      await page.keyboard.type("The same hero for a phone")
      await page.getByRole("button", { name: "Who answers" }).click()
      await sleep(page, 600)
    },
  }),
  screen({
    name: "frame-unanswered",
    description:
      "A drawn frame left unanswered: No Workspace, with Start a chat (#1358).",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    crop: [300, 120, 440, 620],
    // After frame-ask, drawing in the same spot: it deletes the frame the last
    // pass drew, draws its own, then closes the ask.
    prepare: async (page) => {
      await camera(page, VIEW.emptyLeft)
      await clickAt(page, { x: 540, y: 300 }, 300)
      await page.keyboard.press("Delete")
      await page.keyboard.press("f")
      await page.mouse.move(420, 160)
      await page.mouse.down()
      await page.mouse.move(500, 400, { steps: 8 })
      await page.mouse.move(662, 683, { steps: 8 })
      await page.mouse.up()
      await sleep(page, 500)
      // Esc closes the ask; a click on empty canvas drops the selection.
      await page.keyboard.press("Escape")
      await clickAt(page, { x: 330, y: 760 }, 300)
      await page.mouse.move(250, 780)
      await sleep(page, 400)
    },
  }),
  screen({
    name: "mockup-ask",
    description:
      "A box drawn with the Mockup tool asks what to sketch in it (#1359).",
    path: ROOM,
    cookies: SIDEBAR_ONLY,
    crop: [300, 120, 440, 620],
    // After frame-unanswered, drawing in the same spot: it deletes the frame
    // that pass left. An unsent Mockup box writes nothing to the room.
    prepare: async (page) => {
      await camera(page, VIEW.emptyLeft)
      await clickAt(page, { x: 540, y: 300 }, 300)
      await page.keyboard.press("Delete")
      await page.keyboard.press("m")
      await page.mouse.move(420, 160)
      await page.mouse.down()
      await page.mouse.move(500, 400, { steps: 8 })
      await page.mouse.move(662, 683, { steps: 8 })
      await page.mouse.up()
      await sleep(page, 500)
      await page.keyboard.type("Three takes on the empty cart")
      await sleep(page, 600)
    },
  }),
]

/** Pick the Home frame's "Start free trial" button with the element-target tool. */
async function pointAtStartTrial(page: Page, click: boolean) {
  await clickAt(
    page,
    await centerOf(page, "button:has(svg.ph-crosshair)"),
    1000
  )
  const { frame, box } = await previewFrame(page, "/")
  const target = (await frame.evaluate(
    `(() => {
      const a = [...document.querySelectorAll("a")].find((a) => a.textContent.includes("Start free trial"))
      const r = a.getBoundingClientRect()
      return [r.x + r.width / 2, r.y + r.height / 2]
    })()`
  )) as [number, number]
  const scale = box.width / 1280
  const at = { x: box.x + target[0] * scale, y: box.y + target[1] * scale }
  // Glide onto the button rather than jumping there: a single move sometimes
  // lands before the frame's bridge reports hover, so no inspect outline shows.
  await page.mouse.move(at.x - 20, at.y)
  await sleep(page, 400)
  await page.mouse.move(at.x, at.y, { steps: 8 })
  await sleep(page, 1500)
  if (click) {
    await page.mouse.click(at.x, at.y)
    await sleep(page, 1200)
  }
}

const xy = (p: { x: number; y: number }): [number, number] => [p.x, p.y]

/**
 * The demo checkout the Configure repository screen opens. Set by the docs run
 * (`../bin/docs.ts`), which creates it under the docs state dir.
 */
let demoCheckoutPath = ""
export function setDemoCheckoutPath(path: string): void {
  demoCheckoutPath = path
}
const DEMO_CHECKOUT_PATH = () => demoCheckoutPath

/** Look up screens by name, preserving list order. Throws on an unknown name. */
export function selectDocsScreens(names: readonly string[]): DocsScreen[] {
  if (names.length === 0) return DOCS_SCREENS
  const unknown = names.filter(
    (name) => !DOCS_SCREENS.some((s) => s.name === name)
  )
  if (unknown.length > 0) {
    throw new Error(
      `unknown screen(s): ${unknown.join(", ")}\nknown screens: ${DOCS_SCREENS.map((s) => s.name).join(", ")}`
    )
  }
  return DOCS_SCREENS.filter((s) => names.includes(s.name))
}
