// Round 1 captures: each template x option, light and dark at 1280x800 (a Mockup's default size), light on a phone.
import { createRequire } from "node:module"
import { readFileSync, writeFileSync } from "node:fs"
const require = createRequire("/home/user/screenplay/apps/app/package.json")
const { chromium } = require("playwright-core")
const FONTS = readFileSync("/home/user/screenplay/apps/app/lib/skills/screenplay-design-audit/fonts.css", "utf8")
const OUT = new URL("./r1/", import.meta.url).pathname
const only = process.argv[2]
const JOBS = [
  ["audit", "p4"], ["decisions", "q-H1"], ["exploration", null], ["storybook", null],
]
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })
const metrics = {}
for (const [name, anchor] of JOBS) {
  if (only && !only.split(",").includes(name)) continue
  for (const opt of ["", "a", "b", "c"])
    for (const [sz, w, h, themes] of [["desk", 1280, 800, ["light", "dark"]], ["phone", 390, 844, ["light"]]])
      for (const theme of themes) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: theme })
        const page = await ctx.newPage()
        await page.goto(`http://127.0.0.1:5173/${name}/?opt=${opt}`)
        await page.addStyleTag({ content: FONTS })
        await page.waitForTimeout(1000)
        if (theme === "dark") {
          const b = page.getByRole("button", { name: /^(Dark|Light)$/ })
          if ((await b.textContent()).trim() === "Dark") await b.click()
          await page.waitForTimeout(300)
        }
        if (name === "storybook") {
          // a state with something to say
          await page.getByRole("button", { name: "Next state" }).click()
          await page.waitForTimeout(400)
          if (opt === "c") {
            const ov = page.locator(".cursor-crosshair")
            const bb = await ov.boundingBox()
            await page.mouse.click(bb.x + bb.width * 0.5, bb.y + bb.height * 0.56)
            await page.keyboard.type("Make the button full width?")
            await page.mouse.click(bb.x + bb.width * 0.62, bb.y + bb.height * 0.33)
            await page.keyboard.type("Icon reads as a broken image")
            await page.evaluate(() => scrollTo(0, 0))
            await page.waitForTimeout(300)
          }
        }
        if (anchor) {
          await page.evaluate((a) => {
            const el = document.getElementById(a)
            const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--top-bar")) || 0
            scrollTo({ top: scrollY + el.getBoundingClientRect().top - top - 16, behavior: "instant" })
          }, anchor)
          await page.waitForTimeout(300)
        }
        const tag = opt || "today"
        await page.screenshot({ path: `${OUT}${name}-${tag}-${sz}-${theme}.png` })
        if (theme === "light")
          metrics[`${name}-${tag}-${sz}`] = await page.evaluate(() => {
            const items = [...document.querySelectorAll("article[id], [id^=q-]")]
            const ans = (it) => it.querySelector("[role=radiogroup],[role=group],form")
            const gaps = items.map((it) => ans(it) ? ans(it).getBoundingClientRect().top - it.getBoundingClientRect().top : 0)
            const pick = [...document.querySelectorAll("button")].find((b) => /^Pick /.test(b.textContent))
            return {
              page: document.documentElement.scrollHeight,
              items: items.length,
              avgGap: gaps.length ? Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length) : undefined,
              pickY: pick ? Math.round(pick.getBoundingClientRect().top) : undefined,
            }
          })
        await ctx.close()
      }
}
writeFileSync(OUT + `metrics${only ? "-" + only : ""}.json`, JSON.stringify(metrics, null, 1))
await browser.close()
console.log(metrics)
