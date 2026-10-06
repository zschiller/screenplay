import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { chromium, type Browser, type Page } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { BRIDGE_JS } from "./index"

// Fit to content in a real Chrome: the frame's height follows what the bridge
// reports, as the canvas does, on pages whose footer sits under content sized
// to the viewport. Those used to grow by the footer on every change, or stay
// at the frame's height once their content shrank. Skipped where no Chrome is
// installed; CI's browser job has one.

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
if (process.env.SCREENPLAY_REQUIRE_BROWSER_STACK && !CHROME) {
  throw new Error("Chrome is required but wasn't found")
}

const CONTENT = `<h1>Page</h1><p class="item">One</p><p class="item">Two</p>
<p class="item">Three</p><p id="tick">0</p>`

// Each page's footer is 64px tall, under content sized to the viewport.
const LAYOUTS = {
  "a footer after a min-h-screen main": `<style>
  body { margin: 0; font: 16px/24px sans-serif }
  main { min-height: 100vh }
  footer { height: 64px }
</style><main>${CONTENT}</main><footer>Footer</footer>`,
  "a footer pushed down a min-h-screen column": `<style>
  body { margin: 0; font: 16px/24px sans-serif }
  .page { min-height: 100vh; display: flex; flex-direction: column }
  main { flex: 1 }
  footer { height: 64px }
</style><div class="page"><main>${CONTENT}</main><footer>Footer</footer></div>`,
  "a footer under an html and body height: 100% chain": `<style>
  html, body { height: 100%; margin: 0; font: 16px/24px sans-serif }
  #root { min-height: 100%; display: flex; flex-direction: column }
  footer { height: 64px; margin-top: auto }
</style><div id="root"><main>${CONTENT}</main><footer>Footer</footer></div>`,
}

describe.skipIf(!CHROME)("Fit to content on a page with a footer", () => {
  let browser: Browser
  let page: Page

  beforeAll(async () => {
    browser = await chromium.launch({ executablePath: CHROME! })
    page = await browser.newPage()
  })

  afterAll(async () => {
    await browser?.close()
  })

  // Loads the layout in a 400px tall frame that follows the bridge's reports.
  async function fit(body: string) {
    const doc = `<!doctype html><html><head><script>${BRIDGE_JS}</script></head><body>${body}</body></html>`
    await page.setContent(
      `<body style="margin:0"><iframe style="width:600px;height:400px;border:0"></iframe></body>`
    )
    await page.evaluate((doc) => {
      const frame = document.querySelector("iframe")!
      const w = window as unknown as { heights: number[] }
      w.heights = []
      addEventListener("message", (e) => {
        if (e.data?.type === "screenplay:ready")
          frame.contentWindow!.postMessage(
            { type: "screenplay:watch-content-size", on: true },
            "*"
          )
        if (e.data?.type !== "screenplay:content-size") return
        w.heights.push(e.data.height)
        frame.style.height = `${e.data.height}px`
      })
      frame.srcdoc = doc
    }, doc)
    await page.waitForFunction(() => {
      const w = window as unknown as { heights: number[] }
      return w.heights.length > 0
    })
  }

  // The page changes on its own a few times, each change after the frame has
  // followed the last report: what used to grow it by the footer every time.
  async function tick(times: number) {
    for (let i = 0; i < times; i++) {
      await page.evaluate(() => {
        const doc = document.querySelector("iframe")!.contentDocument!
        const tick = doc.getElementById("tick")!
        tick.textContent = String(Number(tick.textContent) + 1)
      })
      await page.waitForTimeout(250)
    }
  }

  const heights = () =>
    page.evaluate(() => (window as unknown as { heights: number[] }).heights)
  const last = async () => (await heights()).at(-1)!

  for (const [name, body] of Object.entries(LAYOUTS)) {
    it(`fits ${name} to its content, and stays there`, async () => {
      await fit(body)
      await tick(5)
      // Four 24px lines and the h1, then the footer: well under the 400px
      // the frame started at.
      const fitted = await last()
      expect(fitted).toBeLessThan(300)
      expect(fitted).toBeGreaterThan(64 + 4 * 24)
      expect(new Set(await heights()).size).toBeLessThanOrEqual(2)
      // The whole page shows, footer included.
      const footer = await page.evaluate(() => {
        const frame = document.querySelector("iframe")!
        const doc = frame.contentDocument!
        return {
          bottom: doc.querySelector("footer")!.getBoundingClientRect().bottom,
          viewport: frame.contentWindow!.innerHeight,
        }
      })
      expect(footer.viewport).toBe(fitted)
      expect(Math.ceil(footer.bottom)).toBe(fitted)
    })

    it(`shrinks ${name} when its content shrinks`, async () => {
      await fit(body)
      await tick(2)
      const before = await last()
      await page.evaluate(() => {
        const doc = document.querySelector("iframe")!.contentDocument!
        doc.querySelectorAll(".item").forEach((el) => el.remove())
      })
      await tick(2)
      expect(await last()).toBeLessThan(before)
    })
  }

  it("gives the page its own heights back when Fit to content is off", async () => {
    await fit(LAYOUTS["a footer after a min-h-screen main"])
    await tick(1)
    const minHeight = () =>
      page.evaluate(() => {
        const frame = document.querySelector("iframe")!
        const main = frame.contentDocument!.querySelector("main")!
        return frame.contentWindow!.getComputedStyle(main).minHeight
      })
    expect(await minHeight()).toBe("0px")
    await page.evaluate(() =>
      document
        .querySelector("iframe")!
        .contentWindow!.postMessage(
          { type: "screenplay:watch-content-size", on: false },
          "*"
        )
    )
    await page.waitForTimeout(100)
    expect(await minHeight()).toBe(`${await last()}px`)
    expect(
      await page.evaluate(() =>
        document
          .querySelector("iframe")!
          .contentDocument!.querySelector("main")!
          .hasAttribute("style")
      )
    ).toBe(false)
  })
})
