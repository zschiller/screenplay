// PROTOTYPE (#984): does a viewer that (re)loads wipe the room's shared state?
import { createRequire } from "node:module"
import { execSync } from "node:child_process"
const require = createRequire(execSync("npm root -g").toString().trim() + "/")
const { chromium } = require("playwright")
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } })
for (const resend of [false, true]) {
  await page.goto("http://localhost:4984/__room")
  await page.evaluate((r) => localStorage.setItem("proto984", JSON.stringify({ route: "soft", resend: r })), resend)
  await page.goto("http://localhost:4984/__room")
  await page.waitForTimeout(1500)
  const A = page.frameLocator("#A")
  await A.locator(".links >> text=Pricing").click()
  await page.waitForTimeout(1000)
  await A.locator("text=Annual").click()
  await page.waitForTimeout(500)
  await page.evaluate(() => document.getElementById("B").contentWindow.location.reload())
  await page.waitForTimeout(1500)
  const v = await page.evaluate(() => ["A", "B"].map((k) => document.getElementById(k).contentDocument.querySelector(".toggle .on")?.textContent))
  console.log(`resend on load=${resend}: after B reloads, A=${v[0]}  B=${v[1]}`)
}
await browser.close()
