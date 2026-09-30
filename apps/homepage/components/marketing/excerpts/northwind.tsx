import { cn } from "@workspace/ui/lib/utils"

import "./northwind.css"

type Version = "main" | "gradient" | "split" | "dark"

const bars = [38, 52, 45, 61, 58, 72, 69, 84, 80, 92, 88, 97]

/**
 * A page of Northwind, the docs world's demo site, as a frame on the canvas
 * shows it. Sized by its frame: put it in an element with `container-type:
 * inline-size` (see `northwind.css`).
 *
 * `version` is which Workspace's build it is: `main`, the "Hero gradient &
 * trust line" change the docs world's agent made, or one of the other two
 * versions of the hero the homepage's figures ask for.
 */
export function Northwind({
  page = "home",
  device = "desktop",
  version = "main",
}: {
  page?: "home" | "pricing"
  device?: "desktop" | "mobile"
  version?: Version
}) {
  const mobile = device === "mobile"
  return (
    <div
      aria-hidden
      className={cn(
        "nw",
        mobile && "nw-mobile",
        version !== "main" && `nw-${version}`
      )}
    >
      <div className="nw-nav">
        <span className="nw-brand">
          <span className="nw-logo" />
          Northwind
        </span>
        {mobile ? null : (
          <span className="nw-links">
            <span>Product</span>
            <span>Pricing</span>
            <span>Customers</span>
          </span>
        )}
        <span className="nw-ctas">
          {mobile ? null : <span>Sign in</span>}
          <span className="nw-btn nw-sm">Get started</span>
        </span>
      </div>
      {page === "home" ? (
        <Home mobile={mobile} version={version} />
      ) : (
        <Pricing />
      )}
    </div>
  )
}

function Home({ mobile, version }: { mobile: boolean; version: Version }) {
  return (
    <div className="nw-hero">
      <div className="nw-copy">
        <span className="nw-pill">New · Session replay is here →</span>
        <div className="nw-h1">Know what your users actually do</div>
        <div className="nw-lede">
          Northwind turns product events into answers. Funnels, retention and
          replays in one place, no SQL required.
        </div>
        <div className="nw-row">
          <span className="nw-btn">Start free trial</span>
          <span className="nw-btn nw-outline">Book a demo</span>
        </div>
        {version === "gradient" ? (
          <div className="nw-trust">Trusted by 4,000+ product teams</div>
        ) : null}
      </div>
      <div className="nw-chart">
        {(mobile ? bars.slice(4) : bars).map((h, i) => (
          <div key={i} className="nw-bar" style={{ height: `${h}%` }} />
        ))}
      </div>
    </div>
  )
}

const plans = [
  ["Starter", 0, "For side projects and early teams."],
  ["Growth", 49, "For teams finding product-market fit."],
  ["Scale", 199, "For companies with serious traffic."],
] as const

function Pricing() {
  return (
    <>
      <div className="nw-hero nw-compact">
        <div className="nw-h1">Simple, usage-based pricing</div>
        <div className="nw-lede">
          Start free. Upgrade when your product takes off.
        </div>
        <div className="nw-toggle">
          <span className="nw-on">Monthly</span>
          <span>Annual · save 20%</span>
        </div>
      </div>
      <div className="nw-plans">
        {plans.map(([name, price, body], i) => (
          <div key={name} className={cn("nw-plan", i === 1 && "nw-featured")}>
            {i === 1 ? <span className="nw-tag">Most popular</span> : null}
            <h3>{name}</h3>
            <div className="nw-price">
              ${price}
              <small>/mo</small>
            </div>
            <p>{body}</p>
            <span className={cn("nw-btn", i !== 1 && "nw-outline")}>
              {price ? "Start trial" : "Get started"}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}
