(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const out = []
  const seen = new Set()
  const triggers = [...document.querySelectorAll('button[aria-haspopup="menu"],button[aria-haspopup="listbox"],button[aria-haspopup="dialog"],[role="combobox"]')].filter((b) => {
    const r = b.getBoundingClientRect()
    return r.width > 0 && r.top >= 0 && r.top < innerHeight && r.left < innerWidth
  }).slice(0, 40)
  for (const t of triggers) {
    const label = t.getAttribute("aria-label") || t.textContent.trim().slice(0, 30)
    if (seen.has(label)) continue
    seen.add(label)
    const opts = { bubbles: true, cancelable: true, button: 0, pointerType: "mouse", isPrimary: true }
    t.dispatchEvent(new PointerEvent("pointerdown", opts))
    await sleep(450)
    if (!document.querySelector('[data-radix-popper-content-wrapper] [role="menu"],[data-radix-popper-content-wrapper] [role="listbox"],[data-radix-popper-content-wrapper] [role="dialog"]')) {
      t.click()
      await sleep(450)
    }
    const menus = [...document.querySelectorAll('[data-radix-popper-content-wrapper]')]
    for (const m of menus) {
      for (const r of globalThis.__alignMeasure(m, "menu:" + label)) out.push(r)
    }
    document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 1, clientY: 1 }))
    await sleep(350)
  }
  return out
})()
