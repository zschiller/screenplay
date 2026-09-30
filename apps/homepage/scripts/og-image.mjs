// Captures the link preview (app/og/page.tsx) into app/opengraph-image.jpg,
// which Next serves as og:image and twitter:image. Re-run it whenever Fig. 1
// or the headline changes:
//
//   pnpm --filter homepage og-image
//
// Starts `next dev` on a spare port, screenshots the 1200×630 layout at 2×,
// and stops the server.
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright-core"

const root = fileURLToPath(new URL("..", import.meta.url))
const out = fileURLToPath(
  new URL("../app/opengraph-image.jpg", import.meta.url)
)
const port = process.env.OG_PORT ?? "3017"
const url = `http://localhost:${port}/og`

const server = spawn("pnpm", ["exec", "next", "dev", "--port", port], {
  cwd: root,
  stdio: ["ignore", "pipe", "inherit"],
  detached: true,
})
const stop = () => {
  try {
    process.kill(-server.pid)
  } catch {}
}
process.on("exit", stop)

async function ready() {
  for (let i = 0; i < 240; i++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${url} never answered`)
}

try {
  await ready()
  // Full Chromium: the headless shell squeezes the word spacing in the
  // excerpt's small type.
  const browser = await chromium.launch({ channel: "chromium" })
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2,
    reducedMotion: "reduce",
  })
  // The page animates (the Working glyph), so wait for load, not network idle.
  await page.goto(url, { waitUntil: "load" })
  await page.evaluate(() => document.fonts.ready)
  // Hide the Next dev indicator in the corner.
  await page.addStyleTag({ content: "nextjs-portal { display: none }" })
  await page.locator("#og").screenshot({ path: out, type: "jpeg", quality: 90 })
  await browser.close()
  console.log(`Wrote ${out}`)
} finally {
  stop()
}
