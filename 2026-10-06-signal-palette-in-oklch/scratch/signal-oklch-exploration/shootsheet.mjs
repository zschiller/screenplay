import { chromium } from '/home/user/screenplay/apps/app/node_modules/playwright-core/index.mjs'
import fs from 'fs'
const d=JSON.parse(fs.readFileSync('sheet.json'))
const b=await chromium.launch({executablePath:process.env.CHROME})
for (const [n,p] of Object.entries(d)) {
  const pg=await b.newPage({viewport:{width:760,height:400},deviceScaleFactor:2})
  await pg.goto('file://'+process.cwd()+'/sheet.html?p='+encodeURIComponent(encodeURIComponent(JSON.stringify(p))))
  await pg.waitForTimeout(300)
  await pg.setViewportSize({width:760,height:await pg.evaluate(()=>document.body.scrollHeight)})
  await pg.screenshot({path:`page/shots/sheet-${n}.png`})
}
await b.close()
