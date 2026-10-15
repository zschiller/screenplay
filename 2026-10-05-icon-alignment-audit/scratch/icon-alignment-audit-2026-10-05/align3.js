globalThis.__alignMeasure = (root, tag) => {
  const out = []
  const canvas = document.createElement("canvas")
  const g = canvas.getContext("2d")
  const metricsCache = new Map()
  const metrics = (cs) => {
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontStretch === "100%" ? "" : ""} ${cs.fontSize} ${cs.fontFamily}`
    if (metricsCache.has(font)) return metricsCache.get(font)
    g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    const H = g.measureText("H")
    const x = g.measureText("x")
    const m = {
      asc: H.fontBoundingBoxAscent,
      desc: H.fontBoundingBoxDescent,
      cap: H.actualBoundingBoxAscent,
      xh: x.actualBoundingBoxAscent,
    }
    metricsCache.set(font, m)
    return m
  }
  const ctx = (el) => {
    const parts = []
    let e = el
    for (let i = 0; e && i < 14; i++, e = e.parentElement) {
      const slot = e.getAttribute && (e.getAttribute("data-slot") || e.getAttribute("data-testid") || e.getAttribute("data-sidebar"))
      const role = e.getAttribute && e.getAttribute("role")
      if (slot) parts.push(slot)
      else if (role) parts.push("@" + role)
    }
    return parts.slice(0, 5).join("<")
  }
  const visible = (el, r) => {
    if (r.width < 1 || r.height < 1) return false
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (cs.visibility === "hidden" || +cs.opacity === 0 || cs.display === "none") return false
    }
    return true
  }
  const textNodes = (root) => {
    const res = []
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let n
    while ((n = w.nextNode())) if (n.textContent.trim()) res.push(n)
    return res
  }
  const dots = [...root.querySelectorAll("span,div,i,img")].filter((e) => {
    if (e.tagName === "IMG") { const r = e.getBoundingClientRect(); return r.width >= 8 && r.width <= 24 && Math.abs(r.width - r.height) < 1 && visible(e, r) }
    if (e.children.length || e.textContent.trim()) return false
    const r = e.getBoundingClientRect()
    if (!(r.width >= 4 && r.width <= 14 && Math.abs(r.width - r.height) < 0.6)) return false
    const cs = getComputedStyle(e)
    const bg = cs.backgroundColor
    const hasFill = (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") || parseFloat(cs.borderTopWidth) > 0 || cs.backgroundImage !== "none" || cs.maskImage !== "none"
    return hasFill && visible(e, r)
  })
  const icons = [...dots, ...[...root.querySelectorAll("svg")].filter((s) => {
    if (s.parentElement && s.parentElement.closest("svg")) return false
    const r = s.getBoundingClientRect()
    return r.width >= 8 && r.width <= 24 && r.height >= 8 && r.height <= 24 && visible(s, r)
  })]
  for (const svg of icons) {
    const ir = svg.getBoundingClientRect()
    const iconC = ir.top + ir.height / 2
    let ink = null
    if (svg.tagName.toLowerCase() === "svg") try {
      const bb = svg.getBBox()
      const vb = svg.viewBox && svg.viewBox.baseVal
      if (vb && vb.height && bb.height) {
        const sy = ir.height / vb.height
        ink = ir.top + (bb.y - vb.y + bb.height / 2) * sy
      }
    } catch {}
    // nearest horizontally adjacent text line in a nearby ancestor
    let best = null
    let anc = svg.parentElement
    for (let lvl = 0; anc && anc !== document.body && !anc.hasAttribute("data-radix-popper-content-wrapper") && lvl < 4 && !best; lvl++, anc = anc.parentElement) {
      for (const tn of textNodes(anc)) {
        if (svg.contains(tn)) continue
        const range = document.createRange()
        range.selectNodeContents(tn)
        for (const rr of range.getClientRects()) {
          if (rr.width < 2) continue
          const overlap = Math.min(rr.bottom, ir.bottom) - Math.max(rr.top, ir.top)
          if (overlap < Math.min(rr.height, ir.height) * 0.4) continue
          const gap = rr.left >= ir.right ? rr.left - ir.right : ir.left >= rr.right ? ir.left - rr.right : -1
          if (gap < 0 || gap > 14) continue
          if (!best || gap < best.gap) best = { tn, rr, gap, side: rr.left >= ir.right ? "R" : "L" }
        }
      }
    }
    if (!best) continue
    const tel = best.tn.parentElement
    if (!visible(tel, best.rr)) continue
    const cs = getComputedStyle(tel)
    const m = metrics(cs)
    // Chrome's text range rect spans the font's ascent+descent (content area).
    const contentH = m.asc + m.desc
    const top = best.rr.top + (best.rr.height - contentH) / 2
    const baseline = top + m.asc
    let probe = null
    const pd = getComputedStyle(tel).display
    if (!/flex|grid/.test(pd)) {
      const sp = document.createElement("span")
      sp.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline"
      tel.insertBefore(sp, best.tn)
      probe = sp.getBoundingClientRect().bottom
      sp.remove()
    }
    const capC = baseline - m.cap / 2
    const xC = baseline - m.xh / 2
    const text = best.tn.textContent.trim().slice(0, 50)
    const iconName = (svg.getAttribute("class") || "").split(/\s+/).find((c) => (c.startsWith("lucide-") && c !== "lucide-icon") || (c.startsWith("ph-") && c !== "ph-dual")) || (svg.getAttribute("class") || "").slice(0, 40)
    out.push({
      tag,
      text,
      icon: iconName,
      iconSize: [+ir.width.toFixed(1), +ir.height.toFixed(1)],
      side: best.side,
      gap: +best.gap.toFixed(1),
      fontSize: parseFloat(cs.fontSize),
      lh: cs.lineHeight,
      weight: cs.fontWeight,
      family: cs.fontFamily.split(",")[0].replace(/["']/g, ""),
      baseErr: probe == null ? null : +(baseline - probe).toFixed(2),
      dCap: +(iconC - capC).toFixed(2),
      dX: +(iconC - xC).toFixed(2),
      dInkCap: ink == null ? null : +(ink - capC).toFixed(2),
      dLine: +(iconC - (best.rr.top + best.rr.height / 2)).toFixed(2),
      kind: svg.tagName.toLowerCase(),
      svgCls: String(svg.getAttribute("class") || "").slice(0, 160),
      textCls: String(tel.getAttribute("class") || "").slice(0, 160),
      parentCls: String(svg.parentElement.getAttribute("class") || "").slice(0, 200),
      ctx: ctx(svg),
      iconBox: [+ir.x.toFixed(1), +ir.y.toFixed(1), +ir.width.toFixed(1), +ir.height.toFixed(1)],
      textBox: [+best.rr.x.toFixed(1), +best.rr.y.toFixed(1), +best.rr.width.toFixed(1), +best.rr.height.toFixed(1)],
    })
  }
  return out
}
globalThis.__alignMeasure(document, "page")
