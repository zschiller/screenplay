import type { Page } from "playwright-core"

import { encodeOutput } from "@/lib/terminal/ttyd-protocol"

/**
 * Stubbed **streams** for screens whose content arrives over the network rather
 * than from the fixture world: the terminal's ttyd WebSocket and the sandbox
 * logs stream. The fixture world has no running sandbox, so without these a
 * terminal shows "Couldn't reach the terminal." and the logs panel a
 * 404 — true, but not the surface a design-polish ticket needs to review.
 *
 * Installed through a Screen's `beforeNavigate` hook, before the first navigation: both
 * surfaces connect the moment they mount (terminal and logs tabs are
 * force-mounted), so a stub installed later would miss the only request.
 */

const ESC = "\x1b["
const sgr = (codes: string, text: string) => `${ESC}${codes}m${text}${ESC}0m`

const NAMES = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
] as const

/** Every one of the 16 ANSI foregrounds, normal row then bright row. */
function swatchRows(): string[] {
  const row = (base: number) =>
    NAMES.map((name, i) => sgr(String(base + i), name)).join(" ")
  return [row(30), row(90)]
}

/**
 * A short, realistic run — a test runner's pass/fail/warn lines, then a swatch
 * of all 16 colours — written in `\r\n` because it is fed straight to xterm, as
 * a PTY would.
 */
export const TERMINAL_SAMPLE = [
  `${sgr("32", "~/checkout-polish")} ${sgr("1", "$")} pnpm test checkout`,
  "",
  ` ${sgr("30;46", " RUN ")} ${sgr("36", "v3.2.4")} ${sgr("90", "/workspace/checkout-polish")}`,
  "",
  ` ${sgr("32", "✓")} app/checkout/page.test.tsx ${sgr("90", "(12 tests)")} ${sgr("33", "84ms")}`,
  ` ${sgr("31", "✗")} app/checkout/summary.test.tsx ${sgr("90", ">")} pins at 768px`,
  `   ${sgr("91", "AssertionError")}: expected ${sgr("32", "'sticky'")}, got ${sgr("31", "'static'")}`,
  ` ${sgr("93", "⚠")} ${sgr("33", "1 snapshot obsolete")} ${sgr("90", "·")} ${sgr("96", "summary.test.tsx.snap")}`,
  "",
  ` ${sgr("1;37", "Test Files")}  ${sgr("1;31", "1 failed")} ${sgr("90", "|")} ${sgr("1;32", "1 passed")} ${sgr("97", "(2)")}`,
  ` ${sgr("35", "Duration")}  ${sgr("34", "1.42s")}`,
  "",
  `${sgr("32", "~/checkout-polish")} ${sgr("1", "$")} ansi-colors`,
  ...swatchRows(),
  `${sgr("32", "~/checkout-polish")} ${sgr("1", "$")} `,
].join("\r\n")

/** The same run as a container's log stream (`\n` lines, like `docker logs`). */
export const LOGS_SAMPLE =
  [
    `${sgr("90", "12:04:31")} ${sgr("36", "[dev]")} ${sgr("1", "next dev")} ${sgr("90", "--port 3000")}`,
    `${sgr("90", "12:04:32")} ${sgr("36", "[dev]")} ${sgr("32", "✓")} Ready in ${sgr("33", "1.8s")}`,
    `${sgr("90", "12:04:40")} ${sgr("36", "[dev]")} ${sgr("32", "GET")} /checkout ${sgr("32", "200")} ${sgr("90", "in 212ms")}`,
    `${sgr("90", "12:04:41")} ${sgr("36", "[dev]")} ${sgr("93", "⚠")} ${sgr("33", "Fast Refresh had to perform a full reload")}`,
    `${sgr("90", "12:04:44")} ${sgr("36", "[dev]")} ${sgr("32", "GET")} /cart ${sgr("31", "500")} ${sgr("90", "in 38ms")}`,
    `${sgr("90", "12:04:44")} ${sgr("36", "[dev]")} ${sgr("91", "TypeError")}: Cannot read properties of undefined (reading ${sgr("32", "'items'")})`,
    `${sgr("90", "12:04:44")} ${sgr("36", "[dev]")}     at ${sgr("96", "CartSummary")} ${sgr("90", "(app/cart/summary.tsx:18:22)")}`,
    `${sgr("90", "12:04:51")} ${sgr("36", "[dev]")} ${sgr("35", "○")} Compiling ${sgr("34", "/cart")} ${sgr("97", "...")}`,
    ...swatchRows(),
  ].join("\n") + "\n"

/** A dev server someone stopped (#1342): its output, then the stop line. */
export const LOGS_STOPPED_SAMPLE =
  [
    `${sgr("90", "12:04:31")} ${sgr("36", "[dev]")} ${sgr("1", "next dev")} ${sgr("90", "--port 3000")}`,
    `${sgr("90", "12:04:32")} ${sgr("36", "[dev]")} ${sgr("32", "✓")} Ready in ${sgr("33", "1.8s")}`,
    `${sgr("90", "12:04:40")} ${sgr("36", "[dev]")} ${sgr("32", "GET")} /alerts ${sgr("32", "200")} ${sgr("90", "in 188ms")}`,
    "",
    "[Dev server stopped]",
  ].join("\n") + "\n"

/** A dev server crashing on start, over and over (#1342). */
export const LOGS_CRASHED_SAMPLE =
  [
    `${sgr("90", "12:06:02")} ${sgr("36", "[dev]")} ${sgr("1", "next dev")} ${sgr("90", "--port 3000")}`,
    `${sgr("90", "12:06:03")} ${sgr("36", "[dev]")} ${sgr("91", "Error")}: Cannot find module ${sgr("32", "'@acme/maps'")}`,
    `${sgr("90", "12:06:03")} ${sgr("36", "[dev]")}     at ${sgr("96", "Module._resolveFilename")} ${sgr("90", "(node:internal/modules/cjs/loader:1145:15)")}`,
    `${sgr("90", "12:06:04")} ${sgr("36", "[dev]")} ${sgr("1", "next dev")} ${sgr("90", "--port 3000")}`,
    `${sgr("90", "12:06:05")} ${sgr("36", "[dev]")} ${sgr("91", "Error")}: Cannot find module ${sgr("32", "'@acme/maps'")}`,
    `${sgr("90", "12:06:05")} ${sgr("36", "[dev]")}     at ${sgr("96", "Module._resolveFilename")} ${sgr("90", "(node:internal/modules/cjs/loader:1145:15)")}`,
  ].join("\n") + "\n"

/**
 * Stub the terminal transport: `/api/terminal/url` hands back a fake origin, and
 * a WebSocket to it answers the client's handshake with {@link TERMINAL_SAMPLE}
 * — ttyd's wire protocol, spoken by the page's own stub instead of a PTY.
 */
export async function stubTerminal(
  page: Page,
  sample: string = TERMINAL_SAMPLE
): Promise<void> {
  // Never dialled: the WebSocket route below answers without connecting out.
  const fakeUrl = "http://127.0.0.1:1/__fixture-terminal"
  await page.route("**/api/terminal/url", (route) =>
    route.fulfill({ json: { url: fakeUrl, token: "" } })
  )
  await page.routeWebSocket(/\/__fixture-terminal\/ws/, (ws) => {
    let greeted = false
    ws.onMessage(() => {
      // The first frame is the handshake; answer it once with the sample.
      if (greeted) return
      greeted = true
      ws.send(Buffer.from(encodeOutput(sample)))
    })
  })
}

/**
 * How the logs stream behaves:
 *
 * - `live` — streams the sample and stays open, as a healthy stream does, so
 *   the panel shows the output with no connection notice. `page.route` can
 *   only answer with a finished body, so this one stands in for the page's
 *   own `fetch` of the logs route.
 * - `reconnecting` — the opening request streams {@link LOGS_SAMPLE} and ends;
 *   the reconnect (`?followOnly=1`) hangs, so the panel is caught mid-reconnect
 *   with its history on screen. Keyed on the query rather than a request count
 *   because a dev build's Strict Mode opens (and aborts) the stream twice.
 * - `error` — every request answers 502, so the panel exhausts its retries.
 */
export type LogsStub = "live" | "reconnecting" | "error"

export async function stubLogs(
  page: Page,
  mode: LogsStub,
  sample: string = LOGS_SAMPLE
): Promise<void> {
  if (mode === "live") {
    await page.addInitScript((body: string) => {
      const realFetch = window.fetch.bind(window)
      window.fetch = (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url
        if (!/\/api\/sandbox\/[^/]+\/logs/.test(url)) {
          return realFetch(input, init)
        }
        const signal = init?.signal
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            // The reconnect's tail is empty; only the opening request
            // replays the history. Never closed, unless aborted.
            if (!url.includes("followOnly")) {
              controller.enqueue(new TextEncoder().encode(body))
            }
            signal?.addEventListener("abort", () =>
              controller.error(new DOMException("Aborted", "AbortError"))
            )
          },
        })
        return Promise.resolve(
          new Response(stream, {
            status: 200,
            headers: { "content-type": "text/plain; charset=utf-8" },
          })
        )
      }
    }, sample)
    return
  }
  await page.route("**/api/sandbox/*/logs**", (route) => {
    if (mode === "error") {
      return route.fulfill({ status: 502, body: "Bad Gateway" })
    }
    if (!new URL(route.request().url()).searchParams.has("followOnly")) {
      return route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: sample,
      })
    }
    // Leave it pending: the reconnect never lands while the shot is taken.
    return undefined
  })
}

/** Where the stubbed Frame Stream answers (see {@link stubFrameStream}). */
const FRAME_STREAM_URL = "ws://frame-stream.screenshots.invalid/"

/**
 * A Frame Stream that says yes (#1392): the app answers that the Workspace's
 * frames can go live, and the stream's socket says ready. The fixture world's
 * Sandboxes are local, so without this the hosted build hides Go live
 * altogether. Enough for the frame bar and the Live tag: a watched frame gets
 * one empty picture, which ends going live's spinner (#1520) but draws
 * nothing, so a live frame's body stays on its loading state. `watch: "none"`
 * never sends one, so going live stays pending, and `watch: "fail"` says the
 * frame's browser failed to start.
 */
export async function stubFrameStream(
  page: Page,
  { watch = "picture" }: { watch?: "picture" | "none" | "fail" } = {}
): Promise<void> {
  // The hosted build reconciles each Workspace with its (absent) Sandbox on
  // load, and stops it on the miss. Hold those server actions so the frames
  // stay as seeded for the length of the shot.
  await page.route("**/*", (route) => {
    const request = route.request()
    if (request.method() === "POST" && request.headers()["next-action"]) return
    return route.fallback()
  })
  await page.route("**/api/frame-stream", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        shared: true,
        url: FRAME_STREAM_URL,
        token: "screenshots",
        expiresAt: Date.now() + 3_600_000,
      }),
    })
  )
  await page.routeWebSocket(FRAME_STREAM_URL, (ws) => {
    ws.onMessage((message) => {
      const msg = JSON.parse(String(message)) as {
        t?: string
        frame?: string
        id?: string
      }
      // Ending live asks for the page's state to seed own copies from: there
      // is none, so the copies open at once.
      if (msg.t === "snapshot")
        ws.send(
          JSON.stringify({
            t: "snapshot",
            frame: msg.frame,
            id: msg.id,
            error: "not live",
          })
        )
      if (msg.t === "auth")
        ws.send(JSON.stringify({ t: "ready", codec: "h264" }))
      if (msg.t === "watch" && msg.frame && watch === "fail") {
        ws.send(
          JSON.stringify({
            t: "frame",
            frame: msg.frame,
            status: "failed",
            width: 0,
            height: 0,
            videoWidth: 0,
            videoHeight: 0,
          })
        )
      }
      if (msg.t === "watch" && msg.frame && watch === "picture") {
        // A video message (see `decodeVideoMessage`) that isn't a keyframe:
        // the view skips it while it waits for one.
        const id = new TextEncoder().encode(msg.frame)
        ws.send(Buffer.from([1, 0, id.length >> 8, id.length & 255, ...id]))
      }
    })
  })
}
