// PROTOTYPE (#982). An extra page on the Northwind demo site that holds one of
// each thing a DOM mirror might get wrong, so the host frame and the watcher's
// mirror can be compared side by side. Not part of the demo site.
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

function Ticker() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 100)
    return () => clearInterval(t)
  }, [])
  return <code data-lab="clock">{now.toISOString().slice(11, 22)}</code>
}

function RafBar() {
  const ref = useRef(null)
  useEffect(() => {
    let raf
    const tick = (t) => {
      if (ref.current) ref.current.style.width = `${(t / 20) % 100}%`
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div className="lab-track">
      <div ref={ref} className="lab-fill" data-lab="raf" />
    </div>
  )
}

function Canvas2D() {
  const ref = useRef(null)
  useEffect(() => {
    const c = ref.current
    const g = c.getContext("2d")
    let raf
    const tick = (t) => {
      g.fillStyle = "#eef2ff"
      g.fillRect(0, 0, c.width, c.height)
      for (let i = 0; i < 12; i++) {
        const h = 20 + 60 * (0.5 + 0.5 * Math.sin(t / 400 + i / 2))
        g.fillStyle = "#4f46e5"
        g.fillRect(8 + i * 18, c.height - h - 8, 12, h)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} width={236} height={100} data-lab="canvas2d" />
}

function WebGL() {
  const ref = useRef(null)
  useEffect(() => {
    const gl = ref.current.getContext("webgl")
    if (!gl) return
    let raf
    const tick = (t) => {
      gl.clearColor(0.5 + 0.5 * Math.sin(t / 500), 0.3, 0.8, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])
  return <canvas ref={ref} width={236} height={100} data-lab="webgl" />
}

export function Lab() {
  const [name, setName] = useState("")
  const [notes, setNotes] = useState("")
  const [plan, setPlan] = useState("growth")
  const [agree, setAgree] = useState(false)
  const [seats, setSeats] = useState(5)
  const [clicks, setClicks] = useState(0)
  const [modal, setModal] = useState(false)
  const dialog = useRef(null)
  const [lastKey, setLastKey] = useState("none")

  useEffect(() => {
    const onKey = (e) => {
      setLastKey(e.key)
      if (e.key === "Escape") setModal(false)
    }
    addEventListener("keydown", onKey)
    return () => removeEventListener("keydown", onKey)
  }, [])

  return (
    <main className="lab">
      <section className="hero center compact">
        <h1>Mirror lab</h1>
        <p>One of each thing a DOM mirror might get wrong.</p>
      </section>
      <div className="lab-grid">
        <div className="card">
          <h3>CSS animation</h3>
          <span className="lab-pulse" data-lab="pulse">Live</span>
          <span className="lab-spin" />
        </div>
        <div className="card">
          <h3>JS updates</h3>
          <p>setInterval every 100ms: <Ticker /></p>
          <p>requestAnimationFrame width:</p>
          <RafBar />
        </div>
        <div className="card">
          <h3>Form</h3>
          <input data-lab="name" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea data-lab="notes" rows={2} placeholder="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <select data-lab="plan" value={plan} onChange={(e) => setPlan(e.target.value)}>
            <option value="starter">Starter</option>
            <option value="growth">Growth</option>
            <option value="scale">Scale</option>
          </select>
          <label><input type="checkbox" data-lab="agree" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I agree</label>
          <input type="range" data-lab="seats" min={1} max={20} value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
          <p data-lab="echo">Hello, {name || "stranger"} · {plan} · {seats} seats · {agree ? "agreed" : "not agreed"} · {notes.length} chars of notes</p>
        </div>
        <div className="card">
          <h3>Buttons and keys</h3>
          <button className="btn sm" data-lab="counter" onClick={() => setClicks((n) => n + 1)}>Clicked {clicks} times</button>
          <p>Last key the page saw: <code data-lab="lastkey">{lastKey}</code></p>
          <details data-lab="details"><summary>Native disclosure</summary><p>Opened by a summary click.</p></details>
        </div>
        <div className="card">
          <h3>Modals</h3>
          <button className="btn sm" data-lab="open-modal" onClick={() => setModal(true)}>React modal</button>{" "}
          <button className="btn sm outline" data-lab="open-dialog" onClick={() => dialog.current.showModal()}>Native dialog</button>
          <dialog ref={dialog} data-lab="dialog"><p>A native &lt;dialog&gt; in the top layer.</p><form method="dialog"><button className="btn sm">Close</button></form></dialog>
        </div>
        <div className="card">
          <h3>Hover (CSS :hover)</h3>
          <span className="lab-hover" data-lab="hover">Hover me<span className="lab-tip">Tooltip from :hover</span></span>
        </div>
        <div className="card">
          <h3>Scroll box</h3>
          <div className="lab-scroll" data-lab="scroll">
            {Array.from({ length: 40 }, (_, i) => <div key={i}>Event #{i + 1} · page_view</div>)}
          </div>
        </div>
        <div className="card">
          <h3>Canvas 2D</h3>
          <Canvas2D />
        </div>
        <div className="card">
          <h3>WebGL</h3>
          <WebGL />
        </div>
        <div className="card">
          <h3>Video</h3>
          <video data-lab="video" src="/clip.webm" width={236} muted loop controls />
        </div>
        <div className="card">
          <h3>Cross-origin iframe</h3>
          <iframe data-lab="xo" src="http://127.0.0.1:4102/widget.html" width={236} height={90} title="widget" />
        </div>
        <div className="card">
          <h3>Image on the dev server</h3>
          <img data-lab="img" src="/photo.svg" width={236} height={90} alt="asset" />
        </div>
      </div>
      {modal && createPortal(
        <div className="lab-backdrop" data-lab="modal" onClick={() => setModal(false)}>
          <div className="card lab-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Upgrade to Growth</h3><p>Press Escape or click outside to close.</p>
            <button className="btn sm" onClick={() => setModal(false)}>Close</button>
          </div>
        </div>, document.body)}
    </main>
  )
}

export const LAB_CSS = `
.lab-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:1040px;margin:0 auto;padding:0 24px 48px}
.lab .card{display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.lab input:not([type]),.lab textarea,.lab select{width:100%;padding:6px 8px;border:1px solid #d7dbe3;border-radius:8px;font:inherit}
.lab-pulse{display:inline-block;padding:4px 10px;border-radius:99px;background:var(--accent);color:#fff;animation:labpulse 1s ease-in-out infinite}
@keyframes labpulse{50%{transform:scale(1.25);opacity:.6}}
.lab-spin{width:18px;height:18px;border:3px solid #c7d2fe;border-top-color:var(--accent);border-radius:50%;animation:labspin .8s linear infinite}
@keyframes labspin{to{transform:rotate(360deg)}}
.lab-track{width:100%;height:8px;background:#eef0f4;border-radius:4px}.lab-fill{height:8px;background:var(--accent);border-radius:4px}
.lab-hover{position:relative;border-bottom:1px dashed #94a3b8;cursor:default}.lab-tip{display:none;position:absolute;left:0;top:24px;background:#0f172a;color:#fff;padding:4px 8px;border-radius:6px;font-size:12px;white-space:nowrap}.lab-hover:hover .lab-tip{display:block}
.lab-scroll{height:90px;overflow:auto;width:100%;border:1px solid #eef0f4;border-radius:8px;padding:4px 8px;font-size:13px}
.lab-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.45);display:grid;place-items:center}.lab-modal{width:320px}
dialog::backdrop{background:rgba(15,23,42,.45)}
`
