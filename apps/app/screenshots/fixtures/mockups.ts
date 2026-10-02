/**
 * Mockup Layer pages for the Fixture World (#1267): two empty-cart options
 * that sit beside the Empty cart Workspace's frame, and a standalone order
 * receipt that started from no frame at all. Self-contained static HTML, as an
 * agent would write them: inline styles, no network.
 */

const BASE_STYLE = `
  * { box-sizing: border-box; margin: 0; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #111827;
    background: #ffffff;
  }
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 24px 48px; border-bottom: 1px solid #e5e7eb;
  }
  .logo { font-weight: 700; font-size: 20px; letter-spacing: -0.02em; }
  nav { display: flex; gap: 28px; font-size: 15px; color: #4b5563; }
  .button {
    display: inline-block; padding: 14px 28px; border-radius: 999px;
    background: #111827; color: #ffffff; font-size: 16px; font-weight: 600;
    text-decoration: none;
  }
  .button.secondary { background: #f3f4f6; color: #111827; }
`

const HEADER = `
  <header>
    <div class="logo">Northwind</div>
    <nav><span>Shop</span><span>Journal</span><span>Cart (0)</span></nav>
  </header>
`

/** Option A: one illustration and one clear way back to the shop. */
export const EMPTY_CART_ILLUSTRATED = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>${BASE_STYLE}
  main {
    display: flex; flex-direction: column; align-items: center;
    text-align: center; padding: 96px 48px; gap: 24px;
  }
  .art {
    width: 220px; height: 160px; border-radius: 24px;
    background: linear-gradient(135deg, #fde68a, #fca5a5);
    display: grid; place-items: center;
  }
  h1 { font-size: 40px; letter-spacing: -0.03em; }
  p { font-size: 18px; color: #6b7280; max-width: 440px; line-height: 1.5; }
</style>
</head>
<body>
${HEADER}
<main>
  <div class="art">
    <svg width="88" height="88" viewBox="0 0 24 24" fill="none" stroke="#111827"
      stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 4h2l2.4 10.2a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L20 7H6.2"/>
      <circle cx="9.5" cy="19" r="1.3"/><circle cx="17" cy="19" r="1.3"/>
    </svg>
  </div>
  <h1>Your cart is empty</h1>
  <p>Nothing here yet. The new season's pieces are a good place to start.</p>
  <a class="button" href="#">Continue shopping</a>
</main>
</body>
</html>`

/** Option B: fill the empty space with things to add, with two knobs. */
export const EMPTY_CART_SUGGESTIONS = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>${BASE_STYLE}
  main { padding: 56px 48px; }
  h1 { font-size: 32px; letter-spacing: -0.02em; }
  .lede { margin-top: 8px; font-size: 16px; color: #6b7280; }
  .grid {
    margin-top: 36px; display: grid; gap: 24px;
    grid-template-columns: repeat(var(--knob-columns, 4), 1fr);
  }
  .card { display: flex; flex-direction: column; gap: 10px; }
  .photo {
    aspect-ratio: 4 / 5; border-radius: calc(var(--knob-photo-radius, 16) * 1px);
  }
  .name { font-size: 15px; font-weight: 600; }
  .price { font-size: 14px; color: #6b7280; }
  .add {
    margin-top: 4px; padding: 10px; border-radius: 999px; border: 0;
    background: #f3f4f6; font: inherit; font-size: 14px; font-weight: 600;
  }
  .actions { margin-top: 40px; display: flex; gap: 12px; }
</style>
</head>
<body>
${HEADER}
<main>
  <h1>Your cart is empty</h1>
  <p class="lede">Popular this week, in case something catches your eye.</p>
  <div class="grid">
    <div class="card"><div class="photo" style="background:#dbeafe"></div>
      <div class="name">Linen overshirt</div><div class="price">$84</div>
      <button class="add">Add to cart</button></div>
    <div class="card"><div class="photo" style="background:#dcfce7"></div>
      <div class="name">Canvas tote</div><div class="price">$32</div>
      <button class="add">Add to cart</button></div>
    <div class="card"><div class="photo" style="background:#fef3c7"></div>
      <div class="name">Wool beanie</div><div class="price">$28</div>
      <button class="add">Add to cart</button></div>
    <div class="card"><div class="photo" style="background:#fce7f3"></div>
      <div class="name">Everyday sneaker</div><div class="price">$120</div>
      <button class="add">Add to cart</button></div>
  </div>
  <div class="actions">
    <a class="button" href="#">Shop everything</a>
    <a class="button secondary" href="#">View saved items</a>
  </div>
</main>
<script>
  screenplay.registerKnob({
    id: "columns", type: "slider", label: "Columns",
    min: 2, max: 4, step: 1, default: 4,
  })
  screenplay.registerKnob({
    id: "photo-radius", type: "slider", label: "Photo radius",
    min: 0, max: 32, step: 2, default: 16,
  })
</script>
</body>
</html>`

/** A standalone exploration: the order receipt email, before any frame. */
export const ORDER_RECEIPT = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>${BASE_STYLE}
  body { background: #f3f4f6; padding: 40px 32px; }
  .mail {
    max-width: 560px; margin: 0 auto; background: #ffffff;
    border-radius: 16px; padding: 40px;
  }
  .logo { margin-bottom: 32px; }
  h1 { font-size: 26px; letter-spacing: -0.02em; }
  .lede { margin-top: 8px; color: #6b7280; font-size: 15px; line-height: 1.5; }
  table { width: 100%; margin-top: 28px; border-collapse: collapse; font-size: 15px; }
  td { padding: 14px 0; border-bottom: 1px solid #e5e7eb; }
  td:last-child { text-align: right; }
  .total td { border: 0; font-weight: 700; padding-top: 18px; }
  .cta { margin-top: 32px; text-align: center; }
</style>
</head>
<body>
<div class="mail">
  <div class="logo">Northwind</div>
  <h1>Thanks, Maya. Your order is in.</h1>
  <p class="lede">Order #10482 ships tomorrow. We'll send tracking the moment it leaves.</p>
  <table>
    <tr><td>Linen overshirt · M</td><td>$84.00</td></tr>
    <tr><td>Canvas tote</td><td>$32.00</td></tr>
    <tr><td>Shipping</td><td>Free</td></tr>
    <tr class="total"><td>Total</td><td>$116.00</td></tr>
  </table>
  <div class="cta"><a class="button" href="#">View your order</a></div>
</div>
</body>
</html>`
