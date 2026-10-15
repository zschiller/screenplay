// node shootm.mjs out.png m [action] [theme]
import { chromium } from "/home/user/screenplay/node_modules/.pnpm/playwright-core@1.56.1/node_modules/playwright-core/index.mjs"
import fs from "node:fs"
const [out, m, act = "", theme = "light"] = process.argv.slice(2)
const css = fs.readFileSync(new URL("./fonts.css", import.meta.url), "utf8")
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: theme, hasTouch: true, isMobile: true })
await p.goto("http://localhost:5173/exploration/?n=g&m=" + m)
await p.addStyleTag({ content: css })
await p.waitForTimeout(900)
for (const a of act.split(",").filter(Boolean)) {
  if (a === "scroll") await p.evaluate(() => scrollTo(0, 700))
  else if (a === "answer") await p.evaluate(() => { const e = document.querySelector("[data-answer]"); scrollTo(0, e.getBoundingClientRect().top + scrollY - 300) })
  else if (a === "pickA") await p.locator("[data-answer] [data-slot=questionnaire-choice]").first().click()
  else if (a === "sheet") await p.locator("button:has(.ph-caret-down)").first().click()
  else if (a === "next") await p.getByRole("button", { name: "Next option" }).first().click()
  else if (a === "pick") await p.locator("button", { hasText: /^Pick [A-Z]$/ }).first().click()
  else if (a.startsWith("open")) await p.locator("[data-opt-card]:visible").nth(+a.slice(4)).click()
  await p.waitForTimeout(400)
}
await p.evaluate(() => document.fonts.ready)
await p.waitForTimeout(300)
const r = await p.evaluate(() => { const x = [...document.querySelectorAll("button")].find((x) => /^Pick(ed)? [A-Z]$/.test(x.textContent.trim()) && x.offsetParent); return x ? Math.round(x.getBoundingClientRect().top) : null })
console.log(out, "pick y", r)
await p.screenshot({ path: out })
await b.close()
