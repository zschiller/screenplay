import type { Page } from "playwright-core"

import { stubTerminal } from "./fixtures/streams"
import {
  connectWorkspaceLifecycle,
  livePreviewDomain,
} from "./fixtures/workspace-lifecycle"
import { FIXTURE_IDS } from "./fixtures/world"
import {
  canvasPanels,
  DEFAULT_VIEWPORT,
  fixtureCheckouts,
  fixtureGitHub,
  homeView,
  NARROW_HOME_VIEWPORT,
  narrowHome,
  openAddProject,
  openChatTab,
  openTerminalTab,
  replayRun,
  tabTo,
  type RunEvent,
} from "./screens"

/**
 * The **named interactions** — short flows the harness records to video.
 *
 * A still can't review a motion change: an entrance animation, a drag, a panel
 * that slides. Each entry here is one flow, named so a PR can say "recorded
 * `open-canvas`" and a reviewer can re-record the same thing on their own branch
 * and compare like for like.
 *
 * Keep them **short and legible** — a few seconds, one idea. A recording that
 * wanders is a recording nobody scrubs. And keep every step tolerant: a flow that
 * throws mid-record yields a truncated video and no explanation, so a step that
 * can't find its target should narrate and move on rather than fail the run.
 */

export interface Interaction {
  /** Filename stem and the name passed on the command line. */
  name: string
  description: string
  /** Where the flow starts. */
  path: string
  viewport?: { width: number; height: number }
  /** Cookies set before the first navigation — same mechanism as a Screen's,
   *  for flows that start with a panel already open. */
  cookies?: Array<{ name: string; value: string }>
  /** Runs before the first navigation — same hook as a Screen's. */
  beforeNavigate?: (page: Page) => Promise<void>
  /** The flow itself. `page` is already loaded at `path` and settled. */
  run: (page: Page) => Promise<void>
}

const ids = FIXTURE_IDS

export const INTERACTIONS: Interaction[] = [
  {
    name: "open-canvas",
    description: "Home → open a Canvas → the canvas paints its Groups.",
    path: "/",
    run: async (page) => {
      await click(
        page,
        page.getByText("Checkout flow", { exact: false }).first()
      )
      await page
        .waitForURL(`**/${ids.rooms.checkout}`, { timeout: 30_000 })
        .catch(() => {})
      await page.waitForTimeout(3500)
    },
  },
  {
    name: "canvas-loading",
    description:
      "Opening a Canvas by URL on a slow connection: the loading skeleton, then the Canvas fading in over it.",
    path: "/",
    run: async (page) => {
      // Locally the Canvas answers in milliseconds, which is too fast to
      // review. Add latency to every request so the skeleton has a few seconds
      // on screen, as it would on a slow machine. A full load rather than a
      // click from home: `next dev` doesn't prefetch, so a soft navigation
      // would sit on the home page instead of showing the loading state.
      const cdp = await page.context().newCDPSession(page)
      await cdp.send("Network.enable")
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 800,
        downloadThroughput: -1,
        uploadThroughput: -1,
      })
      await page
        .goto(`/${ids.rooms.checkout}`, { timeout: 60_000 })
        .catch(() => {})
      await page.waitForTimeout(6000)
    },
  },
  {
    name: "canvas-placeholder-add",
    description:
      "Arming the Frame tool and clicking a Group's add placeholder, then the same with the Document tool: each add drops back to Select.",
    path: `/${ids.rooms.checkout}`,
    run: async (page) => {
      await step(() =>
        page.getByText("Checkout brief").first().waitFor({ timeout: 60_000 })
      )
      // Zoom out so each Group's trailing placeholder is on screen.
      await page.keyboard.press("Control+Minus")
      await page.waitForTimeout(1500)
      await click(
        page,
        page.getByRole("button", { name: "Frame", exact: true })
      )
      await page.waitForTimeout(900)
      await click(
        page,
        page.getByRole("button", { name: "Add frame to group" }).first()
      )
      await page.waitForTimeout(1800)
      await click(
        page,
        page.getByRole("button", { name: "Document", exact: true })
      )
      await page.waitForTimeout(900)
      await click(
        page,
        page.getByRole("button", { name: "Add document to group" }).first()
      )
      await page.waitForTimeout(1800)
    },
  },
  {
    name: "canvas-zoom",
    description: "Zooming and panning the reference Canvas.",
    path: `/${ids.rooms.checkout}`,
    run: async (page) => {
      const box = page.viewportSize() ?? DEFAULT_VIEWPORT
      const cx = box.width / 2
      const cy = box.height / 2
      await page.mouse.move(cx, cy)
      // Ctrl+wheel is the canvas's zoom gesture; a bare wheel pans.
      for (let i = 0; i < 12; i++) {
        await page.keyboard.down("Control")
        await page.mouse.wheel(0, -40)
        await page.keyboard.up("Control")
        await page.waitForTimeout(60)
      }
      await page.waitForTimeout(500)
      for (let i = 0; i < 10; i++) {
        await page.mouse.wheel(60, 30)
        await page.waitForTimeout(60)
      }
      await page.waitForTimeout(1200)
    },
  },
  {
    name: "canvas-zoom-recover",
    description:
      "Zooming the reference Canvas all the way out, then recovering with zoom to fit (⇧1), 100% (⌘0), and the zoom menu's Zoom to fit.",
    path: `/${ids.rooms.checkout}`,
    run: async (page) => {
      const box = page.viewportSize() ?? DEFAULT_VIEWPORT
      await page.mouse.move(box.width / 2, box.height / 2)
      for (let i = 0; i < 8; i++) {
        await page.keyboard.down("Control")
        await page.mouse.wheel(0, 20)
        await page.keyboard.up("Control")
        await page.waitForTimeout(120)
      }
      await page.waitForTimeout(1200)
      await page.keyboard.press("Shift+Digit1")
      await page.waitForTimeout(1500)
      await page.keyboard.press("Control+0")
      await page.waitForTimeout(1500)
      await page.keyboard.press("Control+Minus")
      await page.waitForTimeout(800)
      await click(page, page.getByRole("button", { name: /^Zoom, / }))
      await page.waitForTimeout(600)
      await click(page, page.getByRole("menuitem", { name: /Zoom to fit/ }))
      await page.waitForTimeout(1500)
    },
  },
  {
    name: "agent-chat",
    description: "Scrolling back through a finished agent turn.",
    path: `/${ids.rooms.checkout}`,
    // Start with the panel already open, so the recording is the scroll rather
    // than a click on a panel toggle.
    cookies: canvasPanels({ chatPct: 30 }),
    run: async (page) => {
      // Scroll the log rather than the window: the chat panel is its own
      // scroll container, so park the pointer over it first.
      const box = page.viewportSize() ?? DEFAULT_VIEWPORT
      await page.mouse.move(box.width - box.width * 0.15, box.height / 2)
      await page.waitForTimeout(800)
      for (let i = 0; i < 6; i++) {
        await page.mouse.wheel(0, -180)
        await page.waitForTimeout(160)
      }
      await page.waitForTimeout(1200)
    },
  },
  {
    name: "chat-stop",
    description:
      "A run streams into an empty chat, then the user stops it part-way.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    run: async (page) => {
      const chatId = ids.chats.fresh
      // No agent runs here: the send and stop requests are answered locally,
      // and the run itself is replayed as the broadcasts a real one sends.
      await page.route("**/api/agent/stream", (route) =>
        route.fulfill({ status: 200, body: "{}" })
      )
      await page.route("**/api/agent/stop", async (route) => {
        await replayRun(page, chatId, [
          { type: "chat-control", control: { kind: "stopped" } },
          { type: "chat-stream-end" },
        ])
        await route.fulfill({ status: 200, body: '{"success":true}' })
      })
      await openChatTab(page, "New chat").catch(() => {})
      await page.waitForTimeout(1200)

      const prompt = "Make the order summary sticky on mobile."
      await replayRun(page, chatId, [
        {
          type: "chat-acp-update",
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: prompt },
          },
        },
        { type: "chat-stream-start" },
      ])
      await page.waitForTimeout(1600)
      await replayRun(page, chatId, [
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
      ])
      await page.waitForTimeout(900)
      const reply =
        "The summary sits in the right column, so on mobile it lands under the form. I'll pin it to the bottom of the viewport below 768px and keep the pay button inside it, so the total and the action stay together while"
      const words = reply.split(" ")
      for (let i = 0; i < words.length; i += 3) {
        const chunk: RunEvent = {
          type: "chat-acp-update",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: {
              type: "text",
              text: `${i ? " " : ""}${words.slice(i, i + 3).join(" ")}`,
            },
          },
        }
        await replayRun(page, chatId, [chunk])
        await page.waitForTimeout(140)
      }
      await page.waitForTimeout(600)
      await click(
        page,
        page.locator('[title="Stop"], [aria-label="Stop"]').first()
      )
      await page.waitForTimeout(2500)
    },
  },
  {
    name: "settings-sections",
    description:
      "Settings at the narrow width, stepping through its sections: the current one bolds without moving the ones beside it.",
    path: "/settings",
    viewport: NARROW_HOME_VIEWPORT,
    cookies: narrowHome(),
    run: async (page) => {
      const nav = page.getByRole("navigation", { name: "Settings" })
      for (const name of [
        "Coding agents",
        "GitHub",
        "Repository presets",
        "Account",
        "General",
      ]) {
        await click(page, nav.getByRole("link", { name, exact: true }))
        await page.waitForTimeout(900)
      }
    },
  },
  {
    name: "theme-toggle",
    description: "Settings → flipping appearance from light to dark and back.",
    path: "/settings",
    run: async (page) => {
      await click(page, page.getByRole("button", { name: /^dark$/i }).first())
      await page.waitForTimeout(1500)
      await click(page, page.getByRole("button", { name: /^light$/i }).first())
      await page.waitForTimeout(1500)
    },
  },
  {
    name: "terminal-theme-switch",
    description:
      "An open terminal tab while the app flips light → dark → light, without reopening it.",
    path: `/${ids.rooms.checkout}`,
    cookies: canvasPanels({ chatPct: 30 }),
    beforeNavigate: stubTerminal,
    run: async (page) => {
      await openTerminalTab(page).catch(() =>
        console.warn("  ! skipped a step: could not open a terminal tab")
      )
      await page.waitForTimeout(1500)
      // Flip the theme the way a second window's Settings change reaches this
      // one: next-themes follows the \`storage\` event, so the canvas (and its
      // open terminal) re-themes in place with no navigation.
      for (const theme of ["dark", "light"]) {
        await page.evaluate(`(() => {
          localStorage.setItem("theme", "${theme}")
          window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "${theme}" }))
        })()`)
        await page.waitForTimeout(1800)
      }
    },
  },
  {
    name: "browse-folders",
    description: "Walking the Folder tree from All files into a nested Folder.",
    path: "/files",
    run: async (page) => {
      await click(
        page,
        page.getByText("Design system", { exact: false }).first()
      )
      await page.waitForTimeout(1500)
      await click(page, page.getByText("Archive", { exact: false }).first())
      await page.waitForTimeout(1500)
      await page.goBack()
      await page.waitForTimeout(1200)
    },
  },
  {
    name: "add-project",
    description:
      "Add repository: pick a GitHub repo, step Back to the list with the search kept, then add a folder and step Back to its path.",
    path: `/${ids.rooms.checkout}`,
    cookies: fixtureGitHub(),
    run: async (page) => {
      const { checkout } = fixtureCheckouts()
      await step(() => openAddProject(page, "github"))
      await page.waitForTimeout(1000)
      await step(() => page.keyboard.type("docs", { delay: 80 }))
      await page.waitForTimeout(600)
      await click(page, page.getByText("acme/docs").first())
      await page.waitForTimeout(1800)
      await click(page, page.getByRole("button", { name: "Back" }))
      await page.waitForTimeout(1500)
      await page.keyboard.press("Escape")
      await page.waitForTimeout(800)
      await step(() => openAddProject(page, "folder"))
      await step(() =>
        page
          .getByPlaceholder("/path/to/your/clone")
          .pressSequentially(checkout, { delay: 15 })
      )
      await click(page, page.getByRole("button", { name: "Add", exact: true }))
      await page.waitForTimeout(1800)
      await page.keyboard.press("Escape")
      await page.waitForTimeout(1500)
    },
  },
  {
    name: "keyboard-home",
    description:
      "Home by keyboard alone: Tab through the grid to a tile's ⋯ menu, open Move to…, arrow through destinations.",
    path: "/files",
    run: async (page) => {
      // Slow enough per press that a reviewer can follow the focus ring.
      await step(() => tabTo(page, "Folder actions", { delayMs: 350 }))
      await page.waitForTimeout(700)
      await page.keyboard.press("Enter")
      await page.waitForTimeout(700)
      // The menu opens on its first item, Rename; Move to… is next.
      await page.keyboard.press("ArrowDown")
      await page.waitForTimeout(500)
      await page.keyboard.press("Enter")
      await page.waitForTimeout(900)
      for (const key of ["ArrowDown", "ArrowDown", "ArrowUp"]) {
        await page.keyboard.press(key)
        await page.waitForTimeout(600)
      }
      await page.keyboard.press("Escape")
      await page.waitForTimeout(900)
    },
  },
  {
    name: "keyboard-home-table",
    description:
      "The table view by keyboard: Tab down the rows, each row's ⋯ button showing as it takes focus.",
    path: "/files",
    cookies: homeView("table"),
    run: async (page) => {
      await step(() => tabTo(page, "Canvas actions", { delayMs: 350 }))
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press("Tab")
        await page.waitForTimeout(450)
      }
      await page.waitForTimeout(800)
    },
  },
  {
    name: "player-keyboard",
    description:
      "The player HUD by keyboard: open the Knobs panel, close it with Escape, again with reduced motion on.",
    path: `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}`,
    run: async (page) => {
      await page.waitForTimeout(800)
      for (const reducedMotion of ["no-preference", "reduce"] as const) {
        await page.emulateMedia({ reducedMotion })
        // Focus the device picker and Tab once to Knobs — its neighbour in the
        // pill — the way a keyboard user reaches it.
        await step(() =>
          page
            .getByRole("combobox", { name: /^device/i })
            .first()
            .focus()
        )
        await page.keyboard.press("Tab")
        await page.waitForTimeout(500)
        await page.keyboard.press("Enter")
        await page.waitForTimeout(1200)
        await page.keyboard.press("Escape")
        await page.waitForTimeout(1200)
      }
    },
  },
  {
    name: "player-device-switch",
    description:
      "The player on /cart, switched to a phone and back to desktop: the prototype should stay on /cart.",
    path: `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}`,
    run: async (page) => {
      await page.waitForTimeout(800)
      // Navigate inside the prototype, the way a user clicking through it would.
      const src = await page.locator("iframe").first().getAttribute("src")
      const frame = page.frames().find((f) => f !== page.mainFrame())
      if (!src || !frame) {
        console.warn("  ! skipped a step: could not find the prototype frame")
        return
      }
      await frame.waitForLoadState("load").catch(() => {})
      await page.waitForTimeout(1000)
      await step(() => frame.goto(new URL("cart", src).href))
      await page.waitForTimeout(1200)
      // An option's name is its label then its size ("iPhone 17 Pro402×874"),
      // so anchor on the digit to keep "iPhone 17 Pro Max" out.
      for (const device of [/^iPhone 17 Pro\s*\d/, /^Desktop\s*1920/]) {
        await click(page, page.getByRole("combobox", { name: /^device/i }))
        await page.waitForTimeout(400)
        await click(page, page.getByRole("option", { name: device }))
        await page.waitForTimeout(1800)
      }
    },
  },
  {
    name: "player-hud-drag",
    description:
      "Dragging the player HUD across the screen and letting it snap to a corner, then again with reduced motion on.",
    path: `/play/${ids.rooms.checkout}/${ids.branches.checkoutPolish}`,
    run: async (page) => {
      const box = page.viewportSize() ?? DEFAULT_VIEWPORT
      await page.waitForTimeout(800)
      const targets = [
        { x: box.width * 0.3, y: box.height * 0.35 },
        { x: box.width * 0.7, y: box.height * 0.65 },
      ]
      for (const [i, reducedMotion] of (
        ["no-preference", "reduce"] as const
      ).entries()) {
        await page.emulateMedia({ reducedMotion })
        const grip = page.getByLabel("Drag to a corner").first()
        const from = await grip.boundingBox().catch(() => null)
        if (!from) {
          console.warn("  ! skipped a step: could not find the HUD grip")
          return
        }
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
        await page.mouse.down()
        await page.mouse.move(targets[i]!.x, targets[i]!.y, { steps: 25 })
        await page.mouse.up()
        await page.waitForTimeout(1500)
      }
    },
  },
  {
    name: "new-canvas",
    description:
      "New canvas from home, then naming it: a dialog before #777, the Canvas's breadcrumb after.",
    path: "/",
    run: async (page) => {
      await page.waitForTimeout(800)
      // The header button can be clicked before hydration wires it up, so
      // retry until something happens (a dialog, or the Canvas route).
      const dialog = page.getByRole("dialog")
      for (let i = 0; i < 5; i++) {
        if ((await dialog.count()) || new URL(page.url()).pathname !== "/") {
          break
        }
        await click(
          page,
          page.getByRole("button", { name: "New canvas" }).first()
        )
        await page.waitForTimeout(1200)
      }
      // Before #777 a dialog asks for the name first; type it there.
      if (await dialog.count()) {
        await page.keyboard.type("Onboarding", { delay: 90 })
        await page.waitForTimeout(400)
        await page.keyboard.press("Enter")
      }
      await step(() =>
        page.waitForURL((url) => url.pathname !== "/", {
          timeout: 30_000,
          waitUntil: "commit",
        })
      )
      await page.waitForTimeout(2500)
      // After #777 the Canvas opens as Untitled; name it from the breadcrumb.
      if (!(await dialog.count())) {
        await step(() =>
          page.getByText("Untitled", { exact: true }).first().dblclick()
        )
        await page.waitForTimeout(400)
        await page.keyboard.type("Onboarding", { delay: 90 })
        await page.waitForTimeout(400)
        await page.keyboard.press("Enter")
      }
      await page.waitForTimeout(1500)
    },
  },
  {
    name: "frame-boot",
    description:
      "A frame follows its Workspace from booting, through the dev server starting, to the live page.",
    path: `/${ids.rooms.frameStates}`,
    beforeNavigate: resetBootWorkspace,
    run: (page) => bootWorkspace(page),
  },
  {
    name: "play-boot",
    description:
      "The prototype player follows its Workspace from booting to the live page.",
    path: `/play/${ids.rooms.frameStates}/${ids.branches.framesLive}?iframe-layer=layer-frames-live`,
    beforeNavigate: resetBootWorkspace,
    run: (page) => bootWorkspace(page),
  },
  {
    name: "new-canvas-empty",
    description:
      "An empty folder's New canvas: home holds with a spinner, then the new Canvas opens.",
    path: `/files/${ids.folders.drafts}`,
    // Compile the Canvas route first, so `next dev` isn't what the recording
    // waits on.
    beforeNavigate: async (page) => {
      await page.request.get(`/${ids.rooms.empty}`, { timeout: 120_000 })
    },
    run: async (page) => {
      await page.waitForTimeout(800)
      await click(
        page,
        page
          .getByRole("main")
          .getByRole("button", { name: "New canvas" })
          .last()
      )
      await page
        .waitForURL((url) => !url.pathname.startsWith("/files"), {
          timeout: 30_000,
        })
        .catch(() => {})
      await page.waitForTimeout(2500)
    },
  },
  {
    name: "frame-route-edit",
    description:
      "Editing a frame's route in place (#1149): hover, click to select it, type to filter, arrow to a suggestion and Enter; then click again and Esc puts the route back.",
    path: `/${ids.rooms.checkout}`,
    run: async (page) => {
      await click(
        page,
        page.getByText("Checkout · desktop", { exact: true }).first()
      )
      const route = page
        .locator("#frame-toolbar-portal")
        .getByRole("button", { name: /^Route:/ })
      await step(async () => {
        const box = await route.boundingBox({ timeout: 10_000 })
        if (!box) return
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {
          steps: 15,
        })
      })
      await page.waitForTimeout(900)
      await click(page, route)
      await page.waitForTimeout(1200)
      await page.keyboard.type("/ca", { delay: 180 })
      await page.waitForTimeout(900)
      await page.keyboard.press("ArrowDown")
      await page.waitForTimeout(700)
      await page.keyboard.press("Enter")
      await page.waitForTimeout(1500)
      await click(page, route)
      await page.waitForTimeout(700)
      await page.keyboard.type("/nowhere", { delay: 120 })
      await page.waitForTimeout(900)
      await page.keyboard.press("Escape")
      await page.waitForTimeout(1500)
    },
  },
]

/**
 * Click a target if it is there, and say so if it isn't. A recording is a
 * best-effort artifact — a missing affordance should leave a usable (if shorter)
 * video plus a line in the log, not abort the run.
 */
async function click(
  page: Page,
  locator: ReturnType<Page["locator"]>
): Promise<void> {
  try {
    await locator.click({ timeout: 10_000 })
  } catch {
    console.warn(`  ! skipped a step: could not click ${locator}`)
  }
}

/** Run a step that may not find its target, narrating a miss like {@link click}. */
async function step(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (error) {
    console.warn(
      `  ! skipped a step: ${error instanceof Error ? error.message : error}`
    )
  }
}

/** Put the recording Workspace back on `creating` before the page loads. */
async function resetBootWorkspace(): Promise<void> {
  const lifecycle = await connectWorkspaceLifecycle()
  lifecycle.reset()
  // Give the update a beat to reach the server before the socket closes.
  await new Promise((r) => setTimeout(r, 300))
  lifecycle.close()
}

/**
 * Drive the recording Workspace from booting to running while the page films
 * it, then put it back, so later captures still see it booting.
 */
async function bootWorkspace(page: Page): Promise<void> {
  const lifecycle = await connectWorkspaceLifecycle()
  try {
    await page.waitForTimeout(2500)
    lifecycle.patch({
      status: "starting",
      statusMessage: "Running setup script…",
    })
    await page.waitForTimeout(2500)
    lifecycle.patch({ statusMessage: "Starting dev server…" })
    await page.waitForTimeout(2000)
    lifecycle.patch({
      status: "running",
      statusMessage: "",
      previewDomain: livePreviewDomain(),
    })
    await page.waitForTimeout(6000)
  } finally {
    lifecycle.reset()
    await page.waitForTimeout(300)
    lifecycle.close()
  }
}

/** Look up one interaction by name. Throws with the known names on a miss. */
export function selectInteraction(name: string): Interaction {
  const found = INTERACTIONS.find((i) => i.name === name)
  if (!found) {
    throw new Error(
      `unknown interaction: ${name}\nknown interactions: ${INTERACTIONS.map((i) => i.name).join(", ")}`
    )
  }
  return found
}
