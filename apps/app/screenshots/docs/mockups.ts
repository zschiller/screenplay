/**
 * Mockup Layer pages for the docs world's Pricing experiments canvas (#1267):
 * two ways to show annual pricing, written as a Workspace chat would write
 * them — one self-contained page each, in Northwind's own look.
 */

const STYLE = `
  * { box-sizing: border-box; margin: 0; }
  body {
    --accent: #4f46e5;
    font-family: "Inter Variable", Inter, system-ui, sans-serif;
    color: #0f172a; background: #fff; -webkit-font-smoothing: antialiased;
  }
  .nav {
    display: flex; align-items: center; gap: 32px; padding: 18px 48px;
    border-bottom: 1px solid #eef0f4;
  }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 18px; }
  .logo {
    width: 22px; height: 22px; border-radius: 7px;
    background: conic-gradient(from 200deg, var(--accent), #06b6d4, var(--accent));
  }
  .links { display: flex; gap: 26px; font-size: 15px; color: #475569; flex: 1; }
  .hero { padding: 56px 48px 24px; text-align: center; }
  .hero h1 { font-size: 48px; letter-spacing: -0.04em; font-weight: 800; }
  .hero p { margin-top: 12px; font-size: 18px; color: #475569; }
  .card {
    border: 1px solid #eef0f4; border-radius: 16px; padding: 26px;
    background: #fff; position: relative;
  }
  .price { font-size: 44px; font-weight: 800; letter-spacing: -0.04em; margin: 8px 0; }
  .price small { font-size: 15px; color: #94a3b8; font-weight: 500; }
  .note { font-size: 14px; color: #64748b; }
  .featured { border: 2px solid var(--accent); }
  .btn {
    display: block; margin-top: 20px; padding: 12px; border-radius: 11px;
    background: var(--accent); color: #fff; text-align: center; font-weight: 600;
  }
  .save {
    display: inline-block; font-size: 12px; font-weight: 600; color: #047857;
    background: #d1fae5; padding: 3px 8px; border-radius: 99px;
  }
`

const NAV = `
  <div class="nav">
    <div class="brand"><div class="logo"></div>Northwind</div>
    <div class="links"><span>Product</span><span>Pricing</span><span>Customers</span></div>
  </div>
`

/** Option A: one toggle flips every plan between monthly and annual. */
export const PRICING_TOGGLE_MOCKUP = `<!doctype html>
<html><head><meta charset="utf-8"><style>${STYLE}
  .toggle {
    display: inline-flex; margin-top: 24px; background: #f1f5f9;
    border-radius: 99px; padding: 4px; gap: 4px; font-size: 14px;
  }
  .toggle span { padding: 8px 16px; border-radius: 99px; color: #475569; }
  .toggle .on { background: #fff; color: #0f172a; box-shadow: 0 1px 3px #0002; }
  .plans {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
    max-width: 1000px; margin: 32px auto 0; padding: 0 48px;
  }
</style></head><body>
${NAV}
<div class="hero">
  <h1>Simple pricing</h1>
  <p>Pay yearly and get two months free.</p>
  <div class="toggle"><span>Monthly</span><span class="on">Annual <span class="save">−17%</span></span></div>
</div>
<div class="plans">
  <div class="card"><h3>Starter</h3><div class="price">$0<small>/mo</small></div>
    <div class="note">Free forever</div><a class="btn">Start free</a></div>
  <div class="card featured"><h3>Team</h3><div class="price">$15<small>/mo</small></div>
    <div class="note">$180 billed yearly</div><a class="btn">Try Team</a></div>
  <div class="card"><h3>Business</h3><div class="price">$40<small>/mo</small></div>
    <div class="note">$480 billed yearly</div><a class="btn">Contact sales</a></div>
</div>
</body></html>`

/** Option B: monthly and annual prices side by side on every plan. */
export const PRICING_SIDE_BY_SIDE_MOCKUP = `<!doctype html>
<html><head><meta charset="utf-8"><style>${STYLE}
  .plans {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;
    max-width: 1000px; margin: 32px auto 0; padding: 0 48px;
  }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
  .split div { border-radius: 12px; background: #f8fafc; padding: 12px; }
  .split .yearly { background: #eef2ff; }
  .split .price { font-size: 30px; margin: 4px 0 0; }
</style></head><body>
${NAV}
<div class="hero">
  <h1>Simple pricing</h1>
  <p>Every plan, monthly or yearly. Yearly saves two months.</p>
</div>
<div class="plans">
  <div class="card"><h3>Starter</h3>
    <div class="split"><div><div class="note">Monthly</div><div class="price">$0</div></div>
    <div class="yearly"><div class="note">Yearly</div><div class="price">$0</div></div></div>
    <a class="btn">Start free</a></div>
  <div class="card featured"><h3>Team</h3>
    <div class="split"><div><div class="note">Monthly</div><div class="price">$18</div></div>
    <div class="yearly"><div class="note">Yearly <span class="save">−17%</span></div><div class="price">$15</div></div></div>
    <a class="btn">Try Team</a></div>
  <div class="card"><h3>Business</h3>
    <div class="split"><div><div class="note">Monthly</div><div class="price">$48</div></div>
    <div class="yearly"><div class="note">Yearly <span class="save">−17%</span></div><div class="price">$40</div></div></div>
    <a class="btn">Contact sales</a></div>
</div>
</body></html>`
