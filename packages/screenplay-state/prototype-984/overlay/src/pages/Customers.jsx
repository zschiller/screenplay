import { useEffect, useState } from "react"
// Server data: each viewer fetches on its own.
export function Customers() {
  const [likes, setLikes] = useState(null)
  useEffect(() => { fetch("/api/likes").then((r) => r.json()).then((d) => setLikes(d.likes)) }, [])
  const like = () => fetch("/api/likes", { method: "POST" }).then((r) => r.json()).then((d) => setLikes(d.likes))
  const q = [["“We cut our onboarding drop-off in half in the first month.”", "Maya Chen", "Head of Product, Lumen"], ["“Replays settled arguments our dashboards couldn't.”", "Tomás Rivera", "Design Lead, Paperfold"], ["“The only analytics tool our whole team opens every day.”", "Priya Nair", "CTO, Quartz"]]
  return (
    <main>
      <section className="hero center compact"><h1>Loved by product teams</h1><p>Thousands of teams use Northwind to build what users want.</p>
        <div className="row"><button className="btn outline" data-like onClick={like}>♥ Like · <span data-likes>{likes ?? "…"}</span></button></div></section>
      <section className="grid">{q.map(([t, n, r]) => <figure className="card quote" key={n}><blockquote>{t}</blockquote><figcaption><div className="avatar">{n[0]}</div><div><b>{n}</b><span>{r}</span></div></figcaption></figure>)}</section>
    </main>
  )
}
