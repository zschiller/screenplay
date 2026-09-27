import type { Page } from "playwright-core"

import { encodeOutput } from "@/lib/terminal/ttyd-protocol"

/**
 * Stubbed **streams** for screens whose content arrives over the network rather
 * than from the fixture world: the terminal's ttyd WebSocket and the sandbox
 * logs stream. The fixture world has no running sandbox, so without these a
 * terminal shows "Couldn't reach the sandbox terminal." and the logs panel a
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

/**
 * Stub the terminal transport: `/api/terminal/url` hands back a fake origin, and
 * a WebSocket to it answers the client's handshake with {@link TERMINAL_SAMPLE}
 * — ttyd's wire protocol, spoken by the page's own stub instead of a PTY.
 */
export async function stubTerminal(page: Page): Promise<void> {
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
      ws.send(Buffer.from(encodeOutput(TERMINAL_SAMPLE)))
    })
  })
}

/**
 * How the logs stream behaves:
 *
 * - `reconnecting` — the opening request streams {@link LOGS_SAMPLE} and ends;
 *   the reconnect (`?followOnly=1`) hangs, so the panel is caught mid-reconnect
 *   with its history on screen. Keyed on the query rather than a request count
 *   because a dev build's Strict Mode opens (and aborts) the stream twice.
 * - `error` — every request answers 502, so the panel exhausts its retries.
 */
export type LogsStub = "reconnecting" | "error"

export async function stubLogs(page: Page, mode: LogsStub): Promise<void> {
  await page.route("**/api/sandbox/*/logs**", (route) => {
    if (mode === "error") {
      return route.fulfill({ status: 502, body: "Bad Gateway" })
    }
    if (!new URL(route.request().url()).searchParams.has("followOnly")) {
      return route.fulfill({
        status: 200,
        contentType: "text/plain; charset=utf-8",
        body: LOGS_SAMPLE,
      })
    }
    // Leave it pending: the reconnect never lands while the shot is taken.
    return undefined
  })
}
