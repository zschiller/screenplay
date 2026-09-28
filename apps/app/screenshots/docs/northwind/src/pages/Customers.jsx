export function Customers() {
  const q = [["“We cut our onboarding drop-off in half in the first month.”", "Maya Chen", "Head of Product, Lumen"], ["“Replays settled arguments our dashboards couldn't.”", "Tomás Rivera", "Design Lead, Paperfold"], ["“The only analytics tool our whole team opens every day.”", "Priya Nair", "CTO, Quartz"]]
  return (
    <main>
      <section className="hero center compact"><h1>Loved by product teams</h1><p>Thousands of teams use Northwind to build what users want.</p></section>
      <section className="grid">{q.map(([t, n, r]) => <figure className="card quote" key={n}><blockquote>{t}</blockquote><figcaption><div className="avatar">{n[0]}</div><div><b>{n}</b><span>{r}</span></div></figcaption></figure>)}</section>
    </main>
  )
}
