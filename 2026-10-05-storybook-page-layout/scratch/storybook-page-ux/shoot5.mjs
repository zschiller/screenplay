import { createRequire } from "node:module"
import { readFileSync, writeFileSync } from "node:fs"
const require = createRequire("/home/user/screenplay/apps/app/package.json")
const { chromium } = require("playwright-core")
const FONTS = readFileSync("/home/user/screenplay/apps/app/lib/skills/screenplay-design-audit/fonts.css", "utf8")
const OUT = new URL("./r5/", import.meta.url).pathname
const VARIANTS = { s5: "?m=a&i=c", s5m: "?m=a&i=c" }
const only = process.argv[2]?.split(",")
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })
const m = {}
for (const [tag, q] of Object.entries(VARIANTS)) {
  if (only && !only.includes(tag)) continue
  for (const [sz, w, h, themes] of [["desk", 1280, 800, ["light", "dark"]], ["phone", 390, 844, ["light"]]])
    for (const theme of themes) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 })
      await ctx.addInitScript(() => { try { localStorage.setItem("storybook-frame-status", JSON.stringify({ round: 1, notes: { booting: "Spinner sits too close to the title.", "ws-failed-long": "Clamp the error to three lines." }, general: "" })) } catch {} })
      const p = await ctx.newPage()
      await p.goto(`http://127.0.0.1:5173/storybook/${q}#unassigned-chat`)
      await p.addStyleTag({ content: FONTS }); await p.waitForTimeout(1200)
      if (theme === "dark") { await p.getByRole("button", { name: /^Dark$/ }).click(); await p.mouse.move(5, 300); await p.waitForTimeout(400) }
      if (tag === "da") { await p.getByRole("radio", { name: "Stopped" }).hover(); await p.waitForTimeout(500) }
      if (tag === "s5m") { await p.getByRole("button", { name: /No workspace, can start a chat/ }).click(); await p.waitForTimeout(500) }
      if (tag === "ia") { await p.getByRole("button", { name: "About this storybook" }).click(); await p.waitForTimeout(500) }
      if (tag === "ib") { await p.getByRole("tab", { name: "About" }).click(); await p.waitForTimeout(500) }
      if (tag === "da2") { await p.getByRole("radio", { name: "Stopped" }).click(); await p.mouse.move(5, 300); await p.waitForTimeout(600) }
      await p.screenshot({ path: `${OUT}${tag}-${sz}-${theme}.png` })
      if (sz === "phone") await p.screenshot({ path: `${OUT}${tag}-${sz}-${theme}-full.png`, fullPage: true })
      if (theme === "light") m[`${tag}-${sz}`] = await p.evaluate(() => {
        const r = (el) => el ? Math.round(el.getBoundingClientRect().top + scrollY) : null
        const fig = document.querySelector("figure")
        return { page: document.documentElement.scrollHeight, stageW: fig && Math.round(fig.getBoundingClientRect().width), stageH: fig && Math.round(fig.getBoundingClientRect().height), name: r(document.querySelector("h2")), note: r(document.querySelector("textarea:not([hidden])")), why: r(document.querySelector("h2")?.closest("div")?.parentElement?.querySelector("p")) }
      })
      await ctx.close()
    }
}
writeFileSync(OUT + `m${only ? "-" + only.join("") : ""}.json`, JSON.stringify(m, null, 1)); console.log(m)
await b.close()
