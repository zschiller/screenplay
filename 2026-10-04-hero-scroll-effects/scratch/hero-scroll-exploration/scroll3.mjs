import pw from "playwright-core"
import fs from "fs"
const b = await pw.chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })
const seed=`{let a=12345;Math.random=()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}`
const ROW=(order)=>`addEventListener("scroll",()=>{const ts=[...document.querySelectorAll(".hc-track")];const n=ts.length;const sm=t=>{t=Math.min(Math.max(t,0),1);return t*t*(3-2*t)};ts.forEach((t,i)=>{let p;if(${JSON.stringify(order)}==="near"){p=sm((scrollY-(n-1-i)*45)/110)}else if(${JSON.stringify(order)}==="far"){p=sm((scrollY-i*45)/110)}else{const r=t.getBoundingClientRect();p=sm((200-r.top)/140)}t.style.transformOrigin="50% 100%";t.style.rotate="x "+(p*22).toFixed(2)+"deg"})},{passive:true})`
const GARAGE=`addEventListener("scroll",()=>{const sm=t=>{t=Math.min(Math.max(t,0),1);return t*t*(3-2*t)};document.querySelectorAll(".hc-track").forEach(t=>{t.style.rotate="";const r=t.getBoundingClientRect();const p=sm((150-r.top)/(r.height*0.9));t.style.transformOrigin="50% 0%";t.style.rotate="x "+(p*75).toFixed(2)+"deg"})},{passive:true})`
const FX = { garage: GARAGE }
const steps=[0,40,80,120,160,200,240]
for (const [name, js] of Object.entries(FX)) {
  const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:3, colorScheme:"dark", hasTouch:true, isMobile:true, recordVideo:{dir:`sc2/${name}-vid`, size:{width:390,height:844}} })
  await ctx.addInitScript(seed); await ctx.addInitScript(`if(window===window.top){${js}}`)
  const pg = await ctx.newPage()
  await pg.goto("http://localhost:3101/",{waitUntil:"networkidle"}); await pg.addStyleTag({content:"nextjs-portal{display:none!important}"})
  await pg.waitForTimeout(8000)
  const t0=Date.now()
  for (const y of [0,120,240]) {
    // scroll there in small steps so scroll events fire like a swipe
    const from = await pg.evaluate(()=>scrollY)
    const n=8; for (let i=1;i<=n;i++){ await pg.evaluate(v=>scrollTo({top:v,behavior:"instant"}), from+(y-from)*i/n); await pg.waitForTimeout(25) }
    await pg.screenshot({path:`sc2/${name}-${y}.png`})
  }
  // smooth swipe down and back for the clip
  await pg.evaluate(()=>scrollTo({top:0,behavior:"instant"})); await pg.waitForTimeout(900)
  for (let i=0;i<=60;i++){ await pg.evaluate(v=>scrollTo({top:v,behavior:"instant"}), 320*Math.sin(Math.PI*i/120)); await pg.waitForTimeout(33) }
  await pg.waitForTimeout(600)
  for (let i=60;i>=0;i--){ await pg.evaluate(v=>scrollTo({top:v,behavior:"instant"}), 320*Math.sin(Math.PI*i/120)); await pg.waitForTimeout(33) }
  await pg.waitForTimeout(900)
  const v = pg.video(); await ctx.close(); fs.renameSync(await v.path(), `sc2/${name}.webm`)
  console.log(name)
}
await b.close()
