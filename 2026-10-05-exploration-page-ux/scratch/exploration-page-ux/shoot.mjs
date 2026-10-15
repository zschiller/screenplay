// node shoot.mjs out.png "?opt=a" desk|phone light|dark [js-before-shot]
import { chromium } from "/home/user/screenplay/node_modules/.pnpm/playwright-core@1.56.1/node_modules/playwright-core/index.mjs"
import fs from "node:fs"
const [out, q = "", dev = "desk", theme = "light", pre = ""] = process.argv.slice(2)
const css = fs.readFileSync(new URL("./fonts.css", import.meta.url), "utf8")
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })
const vp = dev === "phone" ? { width: 390, height: 844 } : { width: 1280, height: 800 }
const p = await b.newPage({ viewport: vp, deviceScaleFactor: 2, colorScheme: theme })
await p.goto("http://localhost:5173/exploration/" + q)
await p.addStyleTag({ content: css })
await p.waitForTimeout(800)
if (pre) await p.evaluate(pre)
await p.evaluate(() => document.fonts.ready)
await p.waitForTimeout(400)
const m = await p.evaluate(() => {
  const r = {}
  const pick = [...document.querySelectorAll("button")].find((x) => /^Pick(ed)? [A-Z]$/.test(x.textContent.trim()) && x.offsetParent)
  if (pick) r.pick = Math.round(pick.getBoundingClientRect().top + scrollY)
  const fig = [...document.querySelectorAll("figure")].find((f) => f.offsetParent)
  if (fig) r.capture = Math.round(fig.getBoundingClientRect().top + scrollY)
  r.height = document.documentElement.scrollHeight
  return r
})
console.log(out, JSON.stringify(m))
await p.screenshot({ path: out, fullPage: process.env.FULL === "1" })
await b.close()
