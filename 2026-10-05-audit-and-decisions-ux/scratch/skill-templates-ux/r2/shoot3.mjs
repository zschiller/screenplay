// Round 2 captures: two-column layouts. args: pages (comma) opts (comma)
import { createRequire } from "node:module"
import { readFileSync, writeFileSync } from "node:fs"
const require = createRequire("/home/user/screenplay/apps/app/package.json")
const { chromium } = require("playwright-core")
const FONTS = readFileSync("/home/user/screenplay/apps/app/lib/skills/screenplay-design-audit/fonts.css", "utf8")
const OUT = new URL("./r2/", import.meta.url).pathname
const pages = (process.argv[2] || "audit,decisions").split(",")
const opts = (process.argv[3] || "la,lb,lc,ld").split(",")
const sizes = (process.argv[4] || "desk,phone").split(",")
const ANCHOR = { audit: ["h2", "H2"], decisions: ["q-H1", "H1"] }
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })
const metrics = {}
for (const name of pages) for (const opt of opts)
  for (const [sz, w, h, themes] of [["desk", 1280, 800, ["light", "dark"]], ["phone", 390, 844, ["light"]]].filter((s) => sizes.includes(s[0])))
    for (const theme of themes) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, colorScheme: theme })
      const page = await ctx.newPage()
      page.on("pageerror", (e) => console.log("ERR", name, opt, e.message))
      await page.goto(`http://127.0.0.1:5173/${name}/?opt=${opt}`)
      await page.addStyleTag({ content: FONTS })
      await page.waitForTimeout(1000)
      if (theme === "dark") {
        const b = page.getByRole("button", { name: /^(Dark|Light)$/ })
        if ((await b.textContent()).trim() === "Dark") await b.click()
        await page.waitForTimeout(300)
      }
      const [anchor, id] = ANCHOR[name]
      if (opt === "la" && sz === "desk") {
        await page.locator(`nav[aria-label=Index] a`, { hasText: new RegExp("^" + id) }).first().click()
      } else {
        await page.evaluate((a) => {
          const el = document.getElementById(a)
          const top = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--top-bar")) || 0
          scrollTo({ top: scrollY + el.getBoundingClientRect().top - top - 16, behavior: "instant" })
        }, anchor)
      }
      await page.waitForTimeout(400)
      await page.screenshot({ path: `${OUT}${name}-${opt}-${sz}-${theme}.png` })
      if (theme === "light") metrics[`${name}-${opt}-${sz}`] = await page.evaluate(() => {
        const items = [...document.querySelectorAll("article[id], [id^=q-]")].filter((e) => e.offsetParent)
        const ans = (it) => it.querySelector("[role=radiogroup],[role=group],form")
        const g = items.map((it) => (ans(it) ? ans(it).getBoundingClientRect().top - it.getBoundingClientRect().top : 0))
        return { page: document.documentElement.scrollHeight, avgGap: g.length ? Math.round(g.reduce((a, b) => a + b, 0) / g.length) : null }
      })
      await ctx.close()
    }
writeFileSync(OUT + `metrics-${pages.join("-")}-${opts.join("-")}.json`, JSON.stringify(metrics, null, 1))
await browser.close()
console.log(metrics)
