import { chromium } from "/opt/node-tools/node_modules/playwright-core/index.mjs"
import fs from "node:fs"
const S = process.argv[2], opts = process.argv[3].split(","), frames = +process.argv[4] || 66
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })
for (const o of opts) for (const t of ["light", "dark"]) {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2, colorScheme: t })
  await p.goto(`file://${S}/launch.html?o=${o}&t=${t}&manual`)
  const dir = `${S}/frames/${o}-${t}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
  await p.screenshot({ path: `${S}/out/${o}-${t}-window.png` })
  for (let f = 0; f < frames; f++) {
    await p.evaluate(() => window.__tick(1000 / 30))
    await p.screenshot({ path: `${dir}/${String(f).padStart(3, "0")}.png`, clip: { x: 580, y: 330, width: 240, height: 240 } })
  }
  await p.close()
}
await b.close()
