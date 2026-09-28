// PROTOTYPE (#982): record the 3-second clip the lab page's <video> plays.
import { writeFile } from "node:fs/promises"
import { chromium } from "playwright-core"
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium" })
const page = await browser.newPage()
const b64 = await page.evaluate(async () => {
  const c = document.createElement("canvas"); c.width = 236; c.height = 132
  const g = c.getContext("2d")
  const rec = new MediaRecorder(c.captureStream(24), { mimeType: "video/webm" })
  const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data)
  rec.start()
  const t0 = performance.now()
  await new Promise((done) => { const f = () => { const t = performance.now() - t0; g.fillStyle = `hsl(${t / 10},70%,55%)`; g.fillRect(0, 0, 236, 132); g.fillStyle = "#fff"; g.font = "bold 28px sans-serif"; g.fillText((t / 1000).toFixed(1) + "s", 80, 76); if (t < 3000) requestAnimationFrame(f); else done() }; f() })
  rec.stop(); await new Promise((r) => (rec.onstop = r))
  const buf = await new Blob(chunks).arrayBuffer()
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
})
await writeFile(new URL("./clip.webm", import.meta.url), Buffer.from(b64, "base64"))
await browser.close()
