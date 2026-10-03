import { useKnob } from "@screenplay.space/knobs"
import { Link } from "../router.jsx"
export function Home() {
  const headline = useKnob({ id: "headline", type: "string", label: "Headline", group: "Hero", default: "Know what your users actually do" })
  const showLogos = useKnob({ id: "show-logos", type: "boolean", label: "Show customer logos", description: "The logo strip under the hero", group: "Hero", default: true })
  const layout = useKnob({ id: "hero-layout", type: "tabs", label: "Hero layout", group: "Hero", default: "center", options: [{ value: "center", label: "Center" }, { value: "left", label: "Left" }] })
  return (
    <main>
      <section className={`hero ${layout}`}>
        <span className="pill">New · Session replay is here →</span>
        <h1>{headline}</h1>
        <p>Northwind turns product events into answers. Funnels, retention and replays in one place — no SQL required.</p>
        <div className="row"><Link to="/pricing" className="btn">Start free trial</Link><a className="btn outline">Book a demo</a></div>
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
    </main>
  )
}
