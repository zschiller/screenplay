import { useState } from "react"
import { useKnob } from "@screenplay.space/knobs"
import { Link } from "../router.jsx"
export function Home() {
  const [demoOpen, setDemoOpen] = useState(false)
  const headline = useKnob({ id: "headline", type: "string", label: "Headline", default: "Know what your users actually do" })
  const showLogos = useKnob({ id: "show-logos", type: "boolean", label: "Show customer logos", default: true })
  const layout = useKnob({ id: "hero-layout", type: "select", label: "Hero layout", default: "center", options: [{ value: "center", label: "Centered" }, { value: "left", label: "Left aligned" }] })
  return (
    <main>
      <section className={`hero ${layout}`}>
        <span className="pill">New · Session replay is here →</span>
        <h1>{headline}</h1>
        <p>Northwind turns product events into answers. Funnels, retention and replays in one place — no SQL required.</p>
        <div className="row"><Link to="/pricing" className="btn">Start free trial</Link><a className="btn outline" data-book onClick={() => setDemoOpen(true)}>Book a demo</a></div>
        <div className="chart">
          {[38, 52, 45, 61, 58, 72, 69, 84, 80, 92, 88, 97].map((h, i) => <div key={i} className="bar" style={{ height: `${h}%` }} />)}
        </div>
      </section>
      {showLogos && <section className="logos">{["Lumen", "Paperfold", "Quartz", "Helix", "Oakwood"].map((n) => <span key={n}>{n}</span>)}</section>}
      <section className="grid">
        {[["Funnels", "See exactly where users drop off, step by step."], ["Retention", "Cohorts that update in real time as users return."], ["Replays", "Watch the session behind every data point."]].map(([t, d]) => (
          <div className="card" key={t}><div className="icon" /><h3>{t}</h3><p>{d}</p></div>
        ))}
      </section>
      {demoOpen && <div className="modal-backdrop" data-modal="demo"><div className="modal"><h3>Book a demo</h3><p>Pick a time that works.</p><button className="btn" onClick={() => setDemoOpen(false)}>Close</button></div></div>}
    </main>
  )
}
