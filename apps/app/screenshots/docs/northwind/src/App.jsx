import { useKnob } from "@screenplay.space/knobs"
import { usePath, Link } from "./router.jsx"
import { Home } from "./pages/Home.jsx"
import { Pricing } from "./pages/Pricing.jsx"
import { Customers } from "./pages/Customers.jsx"

export function App() {
  const path = usePath()
  const accent = useKnob({ id: "accent", type: "color", label: "Accent color", default: "#4f46e5" })
  const radius = useKnob({ id: "radius", type: "slider", label: "Corner radius", min: 0, max: 28, step: 1, default: 14 })
  const Page = path.startsWith("/pricing") ? Pricing : path.startsWith("/customers") ? Customers : Home
  return (
    <div style={{ "--accent": accent, "--radius": `${radius}px` }}>
      <nav className="nav">
        <Link to="/" className="brand"><span className="logo" />Northwind</Link>
        <div className="links">
          <Link to="/">Product</Link><Link to="/pricing">Pricing</Link><Link to="/customers">Customers</Link>
        </div>
        <div className="cta-group"><a className="ghost">Sign in</a><Link to="/pricing" className="btn sm">Get started</Link></div>
      </nav>
      <Page />
      <footer className="footer">© 2026 Northwind Analytics · Privacy · Terms</footer>
    </div>
  )
}
