import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import puppeteer, {
  type Browser,
  type FileChooser,
  type KeyInput,
  type Page,
} from "puppeteer-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { WebSocket as NodeWebSocket } from "ws"

import type { DriveOp, DriveResult } from "@/lib/frame-drive/contract"
import { frameDriveContract } from "@/lib/frame-drive/contract-suite"
import {
  FRAME_DRIVE_PATH,
  FRAME_DRIVE_ROOM_PARAM,
  type FrameWhere,
  type PageAsk,
} from "@/lib/frame-drive/canvas/protocol"
import {
  createRelayFrames,
  runFrameDriveRelay,
} from "@/lib/frame-drive/canvas/relay"
import { takeFrameInput } from "@/lib/frame-drive/canvas/take-input"
import { macFrameDriveBackend } from "@/lib/frame-drive/mac/channel"
import type { NativeEvent, NativeInput } from "@/lib/frame-drive/mac/real-input"
import { workspaceFiles } from "@/lib/frame-drive/mac/workspace-files"
import { PNG } from "@/lib/frame-drive/test-page"
import { BRIDGE_JS } from "@/lib/sandbox-bridge"
import {
  startLocalYjsServer,
  type YjsServerHandle,
} from "@/lib/yjs-host/y-websocket-server"

/**
 * The Mac backend with real input (#1385), end to end in a real Chrome: the
 * sidecar's channel on the real local Yjs server, the canvas relay over a real
 * WebSocket, a canvas page whose zoomed, cross-origin frame runs the Sandbox
 * Bridge, and the canvas's own `takeFrameInput`. Chrome's input (CDP) stands
 * in for the desktop shell's: both are real, trusted input to the window, so
 * this checks everything but the shell's own AppKit calls, which the Mac
 * results (`results.md`) cover.
 */

function which(cmd: string): string | null {
  try {
    return (
      execFileSync("sh", ["-c", `command -v ${cmd}`])
        .toString()
        .trim() || null
    )
  } catch {
    return null
  }
}

const CHROME =
  process.env.CHROME ??
  which("google-chrome") ??
  which("chromium") ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : null)
// CI's browser job has Chrome; there a missing one is a failure, not a skip.
if (process.env.SCREENPLAY_REQUIRE_BROWSER_STACK && !CHROME) {
  throw new Error("Chrome is required but wasn't found")
}

const SECRET = "real-input-secret"
const ROOM = "real-input-room"
const FRAME = "frame-1"
const WORKSPACE_FILE = "fixtures/logo.txt"

let browser: Browser
let page: Page
let canvasServer: http.Server
let frameServer: http.Server
let yjs: YjsServerHandle
let dataDir: string
let workspace: string
let relay: { close(): void } | null = null

/** The canvas: a zoomed frame under the overlay that, outside Interact,
 *  takes the pointer, and a field the person might be typing in. */
const canvasHtml = (
  frameUrl: string
) => `<!doctype html><html><body style="margin:0">
<input id="composer" style="position:absolute;left:0;top:560px">
<div style="position:absolute;left:60px;top:40px;width:400px;height:300px">
  <iframe id="frame" src="${frameUrl}" allow="clipboard-read; clipboard-write"
    style="position:absolute;left:0;top:0;width:800px;height:600px;border:0;transform:scale(0.5);transform-origin:0 0;pointer-events:none"></iframe>
  <div id="overlay" style="position:absolute;inset:0"></div>
</div>
<script>
  const frame = document.getElementById("frame")
  window.setTakesPointer = (on) => {
    document.getElementById("overlay").style.display = on ? "none" : ""
    frame.style.pointerEvents = on ? "auto" : "none"
  }
  let seq = 0
  window.askBridge = (message) => new Promise((resolve) => {
    const id = "q" + seq++
    const on = (e) => {
      const d = e.data
      if (!d || d.type !== "screenplay:dom-result" || d.id !== id) return
      removeEventListener("message", on)
      resolve(d.ok ? d.value : { status: "failed", reason: d.error })
    }
    addEventListener("message", on)
    frame.contentWindow.postMessage({ ...message, id }, "*")
  })
</script></body></html>`

const framePage = `<!doctype html><html><head>
<script>${BRIDGE_JS}</script>
<style>body { margin: 8px; font: 14px sans-serif } input, button, select, div { margin: 4px 0 } [hidden] { display: none }</style>
</head><body></body></html>`

function listen(handler: http.RequestListener): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, "127.0.0.1", () => resolve(server))
  })
}

const port = (server: http.Server) => (server.address() as AddressInfo).port

const frameContext = () =>
  page.frames().find((f) => f.url().includes(`:${port(frameServer)}/`))!

/** A bridge message from the canvas, as the canvas sends one. */
const bridge = <T>(message: Record<string, unknown>) =>
  page.evaluate(
    (m) =>
      (
        window as unknown as {
          askBridge(m: unknown): Promise<unknown>
        }
      ).askBridge(m),
    message
  ) as Promise<T>

/** The canvas side of each page ask, as `useDriveFrame` answers it. */
async function pageAsk(ask: PageAsk): Promise<unknown> {
  switch (ask.kind) {
    case "locate":
      return bridge({
        type: "screenplay:drive-locate",
        target: ask.target,
        focus: ask.focus,
        replace: ask.replace,
        show: ask.show,
      })
    case "cursor":
      return bridge({ type: "screenplay:drive-cursor", ...ask.what })
    case "state":
      return bridge({ type: "screenplay:drive-state", selector: ask.selector })
    case "take":
      return page.evaluate(async (at) => {
        const w = window as unknown as {
          takeFrameInput: typeof takeFrameInput
          setTakesPointer(on: boolean): void
          released?: () => void
        }
        const got = await w.takeFrameInput(
          document.getElementById("frame") as HTMLIFrameElement,
          at,
          w.setTakesPointer
        )
        w.released = got.release
        return { window: got.window }
      }, ask.at ?? null)
    case "release":
      return page.evaluate(() => {
        const w = window as unknown as { released?: () => void }
        w.released?.()
        w.released = undefined
        return null
      })
  }
}

/** Chrome's own input and clipboard, standing in for the desktop shell. */
function chromeInput(): NativeInput {
  let held: { text: string; left: string } | null = null
  let chooser: Promise<boolean> | null = null
  const clipboard = {
    read: () => page.evaluate(() => navigator.clipboard.readText()),
    write: (text: string) =>
      page.evaluate((t) => navigator.clipboard.writeText(t), text),
  }
  const modifierKeys = (m: NativeEvent & { kind: "key" }): KeyInput[] =>
    [
      m.modifiers?.shiftKey && "Shift",
      m.modifiers?.ctrlKey && "Control",
      m.modifiers?.altKey && "Alt",
      m.modifiers?.metaKey && "Meta",
    ].filter(Boolean) as KeyInput[]
  const editKeys = { copy: "c", cut: "x", paste: "v", selectAll: "a" } as const
  return {
    async send(events) {
      for (const event of events) {
        switch (event.kind) {
          case "move":
            await page.mouse.move(event.x, event.y)
            break
          case "down":
            await page.mouse.down({ clickCount: event.clickCount })
            break
          case "up":
            await page.mouse.up({ clickCount: event.clickCount })
            break
          case "key": {
            const held = modifierKeys(event)
            for (const k of held) await page.keyboard.down(k)
            if (event.text && event.text !== "\r" && event.key.length !== 1)
              await page.keyboard.sendCharacter(event.text)
            else await page.keyboard.press(event.key as KeyInput)
            for (const k of held.reverse()) await page.keyboard.up(k)
            break
          }
          case "edit":
            await page.keyboard.press(editKeys[event.action] as KeyInput, {
              commands: [event.action],
            })
            break
        }
      }
    },
    async holdClipboard(text) {
      const person = await clipboard.read()
      if (text !== undefined) await clipboard.write(text)
      held = { text: person, left: text ?? person }
    },
    async releaseClipboard() {
      if (!held) return null
      const now = await clipboard.read()
      const copied = now !== held.left ? now : null
      await clipboard.write(held.text)
      held = null
      return copied
    },
    async offerFiles(paths) {
      chooser = page
        .waitForFileChooser({ timeout: 3000 })
        .then((c: FileChooser) => c.accept(paths).then(() => true))
        .catch(() => false)
    },
    async withdrawFiles() {
      const taken = chooser ? await chooser : false
      chooser = null
      return taken
    },
  }
}

const frames = createRelayFrames()
let backend: ReturnType<typeof macFrameDriveBackend>

async function until(check: () => Promise<boolean>, timeout = 5000) {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 25))
  }
}

beforeAll(async () => {
  if (!CHROME) return
  dataDir = await mkdtemp(join(tmpdir(), "real-input-"))
  workspace = await realpath(await mkdtemp(join(tmpdir(), "real-input-ws-")))
  await mkdir(join(workspace, "fixtures"))
  await writeFile(join(workspace, WORKSPACE_FILE), "logo")
  process.env.YJS_PERSISTENCE_DIR = dataDir

  frameServer = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" })
    res.end(framePage)
  })
  // Another origin than the frame's, as the canvas is.
  canvasServer = await listen((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" })
    res.end(canvasHtml(`http://localhost:${port(frameServer)}/`))
  })
  const canvasOrigin = `http://127.0.0.1:${port(canvasServer)}`

  yjs = await startLocalYjsServer({
    port: 0,
    secret: SECRET,
    appPort: String(port(canvasServer)),
  })

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--no-sandbox",
      // One process for the canvas and its frame, so the file chooser and
      // focus are the page's.
      "--disable-site-isolation-trials",
      "--disable-features=IsolateOrigins,site-per-process",
    ],
  })
  const context = browser.defaultBrowserContext()
  for (const origin of [canvasOrigin, `http://localhost:${port(frameServer)}`])
    await context.overridePermissions(origin, [
      "clipboard-read",
      "clipboard-write",
      "clipboard-sanitized-write",
    ])
  page = await browser.newPage()
  await page.setViewport({ width: 900, height: 700 })
  await page.emulateFocusedPage(true)
  await page.goto(canvasOrigin + "/")
  await page.evaluate(`window.takeFrameInput = ${takeFrameInput.toString()}`)
  await until(
    async () =>
      !!frameContext() &&
      (await frameContext().evaluate(() => document.readyState === "complete"))
  )

  frames.register(FRAME, {
    drive: (op: DriveOp) =>
      bridge<DriveResult>({ type: "screenplay:drive", op }),
    stop: () => void bridge({ type: "screenplay:drive-stop" }),
    where: (): FrameWhere => ({
      rect: { x: 60, y: 40, width: 400, height: 300 },
      window: { width: 900, height: 700 },
      zoom: 0.5,
      visibility: "visible",
    }),
    page: pageAsk,
  })
  const url = new URL(FRAME_DRIVE_PATH, `ws://127.0.0.1:${yjs.port}`)
  url.searchParams.set(FRAME_DRIVE_ROOM_PARAM, ROOM)
  url.searchParams.set("token", SECRET)
  relay = runFrameDriveRelay(
    new NodeWebSocket(url.toString(), { origin: canvasOrigin }),
    {
      frames,
      agentDrives: () => true,
      subscribeControl: () => () => {},
    }
  )
  backend = macFrameDriveBackend(ROOM, {
    snapshot: async () => PNG,
    native: chromeInput(),
    files: (_frameId, paths) => workspaceFiles(workspace, paths),
  })
  await until(async () => (await backend.unavailable(FRAME)) === null)
}, 60_000)

afterAll(async () => {
  relay?.close()
  await browser?.close()
  await yjs?.close()
  canvasServer?.close()
  frameServer?.close()
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
  if (workspace) await rm(workspace, { recursive: true, force: true })
})

const load = async (html: string) => {
  await frameContext().evaluate((h) => {
    document.body.innerHTML = h
    // In a function of its own, so each load's top-level names are fresh.
    for (const script of document.body.querySelectorAll("script")) {
      new Function(script.textContent ?? "")()
    }
  }, html)
}

frameDriveContract("Mac with real input (Chrome standing in for the shell)", {
  skip: !CHROME,
  setup: async () => ({
    backend,
    frameId: FRAME,
    load,
    evaluated: () =>
      frameContext().evaluate(
        () => (window as { __evaluated?: boolean }).__evaluated === true
      ),
  }),
  gaps: ["file-picker", "native-picker", "native-select"],
  real: { copies: true, file: WORKSPACE_FILE },
})

describe.skipIf(!CHROME)("Mac real input", () => {
  it("leaves the person's clipboard as it was after the agent copies", async () => {
    await page.evaluate(() => navigator.clipboard.writeText("the person's"))
    await load(
      `<button id="copy" onclick="navigator.clipboard.writeText('agent link')">Copy link</button>`
    )
    const result = await backend.run(FRAME, {
      op: "click",
      target: { selector: "#copy" },
    })
    expect(result).toMatchObject({ value: { copied: "agent link" } })
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "the person's"
    )

    // A paste pastes the agent's copy, and still leaves the person's alone.
    await load(`<input id="to" aria-label="To">`)
    await backend.run(FRAME, { op: "click", target: { selector: "#to" } })
    await backend.run(FRAME, {
      op: "key",
      key: "v",
      modifiers: { metaKey: true },
    })
    const to = await backend.run(FRAME, { op: "elements", selector: "#to" })
    expect(to).toMatchObject({ value: { read: { value: "agent link" } } })
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "the person's"
    )
  })

  it("hands the keyboard back to the field the person was typing in", async () => {
    await page.focus("#composer")
    await load(`<input id="name" aria-label="Name">`)
    await backend.run(FRAME, {
      op: "type",
      target: { selector: "#name" },
      text: "Ada",
    })
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(
      "composer"
    )
    expect(
      await backend.run(FRAME, { op: "elements", selector: "#name" })
    ).toMatchObject({ value: { read: { value: "Ada" } } })
  })

  it("puts the overlay back after a click, so the layer drags again", async () => {
    await load(`<button id="b">B</button>`)
    await backend.run(FRAME, { op: "click", target: { selector: "#b" } })
    expect(
      await page.evaluate(
        () => document.getElementById("overlay")!.style.display
      )
    ).toBe("")
  })

  it("plays a click on a frame scrolled out of the window through the bridge", async () => {
    await page.evaluate(() => {
      document.getElementById("frame")!.parentElement!.style.left = "-2000px"
    })
    try {
      await load(
        `<button id="save" onclick="document.getElementById('out').textContent = 'saved'">Save</button><p id="out">idle</p>`
      )
      expect(
        await backend.run(FRAME, { op: "click", target: { selector: "#save" } })
      ).toMatchObject({ status: "done" })
      expect(
        await backend.run(FRAME, { op: "elements", selector: "#out" })
      ).toMatchObject({ value: { read: { text: "saved" } } })
    } finally {
      await page.evaluate(() => {
        document.getElementById("frame")!.parentElement!.style.left = "60px"
      })
    }
  })
})
