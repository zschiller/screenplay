import { useState } from "react"
import { useSharedState } from "@screenplay.space/state"
const plans = [["Starter", 0, "For side projects and early teams.", ["10k events / mo", "3 dashboards", "7-day history"]], ["Growth", 49, "For teams finding product-market fit.", ["1M events / mo", "Unlimited dashboards", "Session replay"]], ["Scale", 199, "For companies with serious traffic.", ["Unlimited events", "SSO & audit log", "Dedicated support"]]]
export function Pricing() {
  const [annual, setAnnual] = useState(false)
  useSharedState("billing", annual ? "annual" : "monthly", (v) => setAnnual(v === "annual"))
  return (
    <main>
      <section className="hero center compact"><h1>Simple, usage-based pricing</h1><p>Start free. Upgrade when your product takes off.</p>
        <div className="toggle"><button className={!annual ? "on" : ""} onClick={() => setAnnual(false)}>Monthly</button><button className={annual ? "on" : ""} onClick={() => setAnnual(true)}>Annual · save 20%</button></div>
      </section>
      <section className="grid">
        {plans.map(([n, p, d, f], i) => (
          <div className={`card plan ${i === 1 ? "featured" : ""}`} key={n}>
            {i === 1 && <span className="tag">Most popular</span>}
            <h3>{n}</h3><div className="price">${annual ? Math.round(p * 0.8) : p}<small>/mo</small></div><p>{d}</p>
            <ul>{f.map((x) => <li key={x}>{x}</li>)}</ul>
            <a className={`btn ${i === 1 ? "" : "outline"} block`}>{p ? "Start trial" : "Get started"}</a>
          </div>
        ))}
      </section>
    </main>
  )
}
