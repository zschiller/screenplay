// node shootg.mjs out.png width clicks(theme)
import { chromium } from "/home/user/screenplay/node_modules/.pnpm/playwright-core@1.56.1/node_modules/playwright-core/index.mjs"
import fs from "node:fs"
const [out, w = "1280", q = "1", theme = "light"] = process.argv.slice(2)
const css = fs.readFileSync(new URL("./fonts.css", import.meta.url), "utf8")
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })
const vp = { width: +w, height: +w < 500 ? 844 : 800 }
const p = await b.newPage({ viewport: vp, deviceScaleFactor: 2, colorScheme: theme })
await p.goto("http://localhost:5173/exploration/?n=g")
await p.addStyleTag({ content: css })
await p.waitForTimeout(800)
if (+w >= 1024 && q !== "0") {
  // step to question q with Next
  for (let i = 0; i < +q; i++) await p.locator("aside:visible button", { hasText: /^Next/ }).first().click()
}
if (process.env.PICK) await p.locator("aside [data-slot=questionnaire-choice]").nth(+process.env.PICK).click()
await p.evaluate(() => document.fonts.ready)
await p.waitForTimeout(400)
const m = await p.evaluate(() => {
  const r = {}
  const c = document.querySelector("aside [data-slot=questionnaire-choice]")
  if (c) r.answer = Math.round(c.getBoundingClientRect().top)
  const fig = [...document.querySelectorAll("figure")].find((f) => f.offsetParent)
  if (fig) { const b = fig.getBoundingClientRect(); r.capture = [Math.round(b.top), Math.round(b.width)] }
  return r
})
console.log(out, JSON.stringify(m))
await p.screenshot({ path: out })
await b.close()
