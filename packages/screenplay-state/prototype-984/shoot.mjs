import { createRequire } from "node:module"
import { execSync } from "node:child_process"
const require = createRequire(execSync("npm root -g").toString().trim() + "/")
const { chromium } = require("playwright")
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 1080 } })
for (const [name, cfg] of [["today", {}], ["all-on", { route: "soft", resend: true, store: true, auto: true }]]) {
  await page.goto("http://localhost:4984/__room")
  await page.evaluate((c) => localStorage.setItem("proto984", JSON.stringify(c)), cfg)
  await page.goto("http://localhost:4984/__room")
  await page.waitForTimeout(1500)
  const A = page.frameLocator("#A")
  await A.locator(".links >> text=Pricing").click()
  await page.waitForTimeout(1000)
  await A.locator("text=Annual").click()
  await A.locator("[data-field=controlled]").fill("zack@example.com")
  await A.locator("[data-field=uncontrolled]").fill("Zack")
  await A.locator("[data-plan=Scale]").click()
  await page.waitForTimeout(1000)
  await page.screenshot({ path: `shots/${name}.png` })
}
await browser.close()
