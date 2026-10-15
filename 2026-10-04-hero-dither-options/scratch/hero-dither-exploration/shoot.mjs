import pw from "playwright-core"
const modes = process.argv.slice(2)
const b = await pw.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })
for (const mode of modes) {
  for (const [tag, w, h, dpr] of [["d", 1440, 900, 2], ["p", 390, 844, 3]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, colorScheme: "dark", reducedMotion: process.env.RM ? "reduce" : "no-preference" })
    await ctx.addInitScript(`globalThis.__dither=${JSON.stringify(mode)};{let a=12345;Math.random=()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}`)
    const pg = await ctx.newPage()
    await pg.goto("http://localhost:3101/", { waitUntil: "networkidle" })
    await pg.addStyleTag({ content: "nextjs-portal{display:none!important}" })
    await pg.waitForTimeout(9000)
    await pg.mouse.move(5, h - 5)
    await pg.screenshot({ path: `${mode}.${tag}.png` })
    if (tag === "d") {
      // Stir the veil: sweep across the fade above the headline.
      const y = await pg.evaluate(() => document.querySelector("[data-veil]").getBoundingClientRect().top - 30)
      for (let x = 380; x <= 900; x += 5) { await pg.mouse.move(x, y + Math.sin(x / 50) * 30); await pg.waitForTimeout(16) }
      await pg.waitForTimeout(120)
      await pg.screenshot({ path: `${mode}.peek.png` })
      console.log(mode, "veil y", y)
    }
    await ctx.close()
  }
}
await b.close()
