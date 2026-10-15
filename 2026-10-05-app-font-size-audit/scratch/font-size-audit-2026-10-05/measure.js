(() => {
  const out = []
  const ctx = (el) => {
    const parts = []
    let e = el
    for (let i = 0; e && i < 12; i++, e = e.parentElement) {
      const slot = e.getAttribute && (e.getAttribute("data-slot") || e.getAttribute("data-testid") || e.getAttribute("data-sidebar"))
      const role = e.getAttribute && e.getAttribute("role")
      if (slot) parts.push(slot)
      else if (role) parts.push("@" + role)
    }
    return parts.slice(0, 5).join("<")
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
  let el
  while ((el = walker.nextNode())) {
    const direct = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ")
    const isInput = (el.tagName === "INPUT" || el.tagName === "TEXTAREA") && (el.value || el.placeholder)
    if (!direct && !isInput) continue
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) continue
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === "hidden" || +cs.opacity === 0) continue
    out.push({
      text: (direct || el.value || el.placeholder).slice(0, 60),
      tag: el.tagName.toLowerCase(),
      size: parseFloat(cs.fontSize),
      lh: cs.lineHeight,
      weight: cs.fontWeight,
      family: cs.fontFamily.split(",")[0].replace(/["']/g, ""),
      color: cs.color,
      cls: (el.className && el.className.baseVal === undefined ? String(el.className) : "").slice(0, 200),
      ctx: ctx(el),
      box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    })
  }
  return out
})()
