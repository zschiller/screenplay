const { chromium } = require("/home/user/screenplay/apps/app/node_modules/playwright-core")
;(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })
  for (const [w, tag] of [[1280, "desk"], [390, "phone"]]) for (const scheme of ["light","dark"]) {
    const pg = await (await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme })).newPage()
    const errs=[]; pg.on("pageerror", e => errs.push(e.message))
    await pg.goto("file://" + process.argv[2]); await pg.waitForTimeout(800)
    await pg.getByRole("button", { name: /Picking a repository|Next/ }).filter({visible:true}).first().click({timeout:3000}).catch(()=>{}); await pg.waitForTimeout(400)
    for (const V of ["B","A"]) {
      await pg.getByRole("radio", { name: V, exact: true }).first().click().catch(()=>{}); await pg.waitForTimeout(300)
      const root = pg.locator(`[data-proto=${V}]`).filter({visible:true}).first()
      const shot = async n => { await root.screenshot({ path: `${process.argv[3]}/${tag}-${scheme}-${V}-${n}.png` }) }
      await shot(0)
      await root.getByRole("button",{name:"+ New repository"}).click(); await root.getByRole("button",{name:"zschiller/screenplay"}).click(); await pg.waitForTimeout(300); await shot(1)
      await pg.waitForTimeout(900); await shot(2)
      if (V==="B") await root.getByRole("button",{name:"Continue"}).click(); else { await root.locator(".pt-sel").click(); await shot("2m"); await root.locator(".pt-sel").click() }
      await root.getByRole("button",{name:/Advanced/}).click(); await pg.waitForTimeout(200); await shot(3)
      await root.getByRole("button",{name:"Add repository"}).click(); await shot(4)
      await root.getByRole("button",{name:"+ New repository"}).click(); await root.getByRole("button",{name:"zschiller/screenplay"}).click(); await pg.waitForTimeout(1300)
      if (V==="A") await root.locator(".pt-sel").click()
      await shot(5)
      await root.getByRole("button",{name:"Start over"}).click()
    }
    console.log(tag, scheme, errs, await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth))
  }
  await b.close()
})()
