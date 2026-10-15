import { chromium } from "/opt/node-tools/node_modules/playwright-core/index.mjs"
import fs from "node:fs"
const S = process.argv[2], opts = process.argv[3].split(","), frames = +process.argv[4] || 180, ts = (process.argv[5] || "light,dark").split(",")
// A cursor that waits while the water winds up, sweeps past the spinner in an
// S curve, then rests up and to the right.
const path = (f) => {
  if (f < 50) return null
  const u = Math.min((f - 50) / 80, 1), e = u * u * (3 - 2 * u)
  return { x: 420 + 560 * e, y: 560 - 180 * Math.sin(e * Math.PI) - 40 * e }
}
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })
for (const o of opts) for (const t of ts) {
  const p = await b.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2, colorScheme: t })
  await p.goto(`file://${S}/launch.html?o=${o}&t=${t}&manual`)
  const dir = `${S}/frames/${o}-${t}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true })
  for (let f = 0; f < frames; f++) {
    const c = path(f); if (c) await p.mouse.move(c.x, c.y)
    await p.evaluate(() => window.__tick(1000 / 30))
    await p.screenshot({ path: `${dir}/${String(f).padStart(3, "0")}.png`, clip: { x: 350, y: 225, width: 700, height: 450 } })
  }
  if (t === "light" || true) await p.screenshot({ path: `${S}/out/${o}-${t}-window.png` })
  await p.close()
}
await b.close()
