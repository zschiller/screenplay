import { chromium } from '/home/user/screenplay/apps/app/node_modules/playwright-core/index.mjs'
import fs from 'fs'
const d=JSON.parse(fs.readFileSync('palettes.json'))
const b=await chromium.launch({executablePath: process.env.CHROME})
fs.mkdirSync('out',{recursive:true})
for (const [n,rows] of Object.entries(d).filter(([n])=>!process.env.ONLY||process.env.ONLY.split(',').includes(n))) for (const theme of ['light','dark']) {
  const p={fill:{},ink:{}}; for(const r of rows) p[r.group][r.name]=r.css
  const pg=await b.newPage({viewport:{width:720,height:300},deviceScaleFactor:2})
  await pg.goto('file://'+process.cwd()+'/specimen.html?theme='+theme+'&p='+encodeURIComponent(encodeURIComponent(JSON.stringify(p))))
  await pg.waitForTimeout(300)
  const h=await pg.evaluate(()=>document.body.scrollHeight)
  await pg.setViewportSize({width:720,height:h})
  await pg.screenshot({path:`out/spec-${n}.${theme}.png`})
  await pg.close()
}
await b.close()
