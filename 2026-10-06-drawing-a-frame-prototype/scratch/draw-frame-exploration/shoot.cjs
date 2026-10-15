const { chromium } = require(process.cwd() + "/node_modules/playwright-core")
;(async () => {
  const b = await chromium.launch()
  for (const [w, scheme, name] of [[1300, "light", "desk"], [400, "dark", "phone"]]) {
    const p = await b.newPage({ viewport: { width: w, height: 1000 }, colorScheme: scheme })
    const errs = []; p.on("pageerror", e => errs.push(e.message))
    await p.goto("file://" + process.argv[2] + "/draw-frame.html")
    await p.waitForTimeout(800)
    await p.getByRole("button",{name:/^Next/}).first().click().catch(()=>{}); await p.waitForTimeout(400)
    await p.screenshot({ path: process.argv[2] + "/check-" + name + ".png", fullPage: true })
    console.log(name, errs, await p.evaluate(() => document.documentElement.scrollWidth))
  }
  await b.close()
})()
