const { chromium } = require("/home/user/screenplay/apps/app/node_modules/playwright-core")
;(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })
  for (const [w, tag, scheme] of [[1280, "desk", "light"], [1280, "desk", "dark"], [390, "phone", "dark"]]) {
    const pg = await (await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme })).newPage()
    const errs=[]; pg.on("pageerror", e => errs.push(e.message))
    await pg.goto("file://" + process.argv[2]); await pg.waitForTimeout(800)
    await pg.getByRole("button", { name: /Styling the app row|Next/ }).filter({visible:true}).first().click({timeout:3000}).catch(()=>{}); await pg.waitForTimeout(400)
    for (const [V, id] of [["R4A","A1"],["R4B","A2"],["R4C","A3"],["R3C","C"]]) {
      await pg.getByRole("radio", { name: id, exact: true }).first().click().catch(()=>{}); await pg.waitForTimeout(300)
      const root = pg.locator(`[data-proto=${V}]`)
      const shot = async n => root.screenshot({ path: `${process.argv[3]}/${tag}-${scheme}-${V}-${n}.png` })
      await root.getByRole("button",{name:"+ New repository"}).click(); await root.getByRole("button",{name:"zschiller/screenplay"}).click(); await pg.waitForTimeout(1200); await shot(2)
      if (V!=="R3C") { await root.locator("[data-a=menu]").click(); await shot(3); await root.getByRole("menuitemradio",{name:/docs/}).click(); await shot(4) }
      await root.getByRole("button",{name:"Start over"}).click()
    }
    console.log(tag, scheme, errs, await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth))
  }
  await b.close()
})()
