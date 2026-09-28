// PROTOTYPE (#984): drives the room through one scenario per setting and
// prints the drift table after each step. `node drive.mjs` with the room up.
import { createRequire } from "node:module"
import { execSync } from "node:child_process"
const require = createRequire(execSync("npm root -g").toString().trim() + "/")
const { chromium } = require("playwright")

const configs = {
  today: { route: "reload", resend: false, store: false, auto: false },
  "1a soft route + room wins": { route: "soft", resend: true, store: false, auto: false },
  "1a + 2 store": { route: "soft", resend: true, store: true, auto: false },
  "1a + 2 + 1b auto": { route: "soft", resend: true, store: true, auto: true },
}
const only = process.argv[2]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
const wait = (ms = 600) => page.waitForTimeout(ms)
async function table(label) {
  await wait(700)
  const rows = await page.$$eval("#drift tr", (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent)))
  console.log(`\n  -- ${label}`)
  for (const [what, , a, b, st] of rows) console.log(`  ${st === "drift" ? "✗" : "✓"} ${what.padEnd(24)} A=${a.padEnd(28)} B=${b}`)
}
for (const [name, cfg] of Object.entries(configs)) {
  if (only && !name.startsWith(only)) continue
  console.log(`\n==== ${name}`)
  await page.goto("http://localhost:4984/__room")
  await page.evaluate((c) => localStorage.setItem("proto984", JSON.stringify(c)), cfg)
  await page.goto("http://localhost:4984/__room")
  await wait(1500)
  const A = page.frameLocator("#A"), B = page.frameLocator("#B")
  await A.locator(".links >> text=Pricing").click()
  await wait(1200)
  await A.locator("text=Annual").click()
  await A.locator("details summary").first().click()
  await A.locator("[data-field=controlled]").fill("zack@example.com")
  await A.locator("[data-field=uncontrolled]").fill("Zack")
  await page.evaluate(() => document.getElementById("A").contentWindow.scrollTo(0, 300))
  await table("A: Pricing, Annual, FAQ 1, typed in both fields, scrolled")
  await A.locator("[data-plan=Scale]").click()
  await A.locator("[data-modal=sales] input").fill("20")
  await table("A: Contact sales on Scale, 20 seats")
  await A.locator("[data-modal=sales] >> text=Close").click()
  await B.locator(".links >> text=Product").click()
  await wait(1200)
  await B.locator(".links >> text=Pricing").click()
  await wait(1200)
  await table("B: went to Product and back to Pricing (does A keep Annual?)")
  await A.locator(".links >> text=Customers").click()
  await wait(1200)
  await A.locator("[data-like]").click()
  await table("A: Customers, liked once")
  await A.locator(".links >> text=Product").click()
  await wait(1200)
  await A.locator("[data-book]").click()
  await table("A: Home, opened Book a demo")
}
await browser.close()
