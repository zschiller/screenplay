module.exports = (opts) => {
    const q = (s) => [...document.querySelectorAll(s)]
    const byText = (s, t) => q(s).filter((e) => (e.textContent ?? "").trim() === t)
    const mark = (els, v = "hide") => els.forEach((e) => e.setAttribute("data-x", v))
    const has = (o) => opts.includes(o)
    const chrome = has("q1a") || has("q1b") || has("q1c") || has("q2a") || has("q2b") || has("q3a") || has("q3b")
    if (!chrome) return
    // Every option: what the issue lists, gone.
    mark(q('[aria-label="Tools"]').map((e) => e.closest("[data-slot=toolbar], div") ?? e))
    mark(q('[aria-label="Chat options"]'))
    mark(byText("button", "Create PR").map((e) => e.closest("[data-slot=tooltip-trigger]") ?? e))
    mark(q('[aria-label="Choose a chat"]'))
    mark(byText("button", "Start a chat"))
    mark(q("[data-slot=empty-description]"))
    // The breadcrumb pill's ⋯ and the Pages +.
    mark(q('[aria-label="Canvas options"]'))
    mark(q('[aria-label="New page"], [aria-label="Add page"]'))
    // Terminal strip under the chat.
    const tabs = q('[aria-label="Terminals"]')[0]?.closest("[data-slot=resizable-panel]")
    if (tabs) {
      mark([tabs])
      const handle = tabs.previousElementSibling
      if (handle) mark([handle])
    }
    const composer = q("[data-slot=composer]")[0]
    if (composer) {
      if (has("q1b")) {
        composer.setAttribute("data-x", "note")
        composer.innerHTML = '<p class="x-note">Only Local User can send in this chat.</p>'
      } else if (has("q1c")) {
        composer.setAttribute("data-x", "disabled")
        const addon = composer.querySelector("[data-slot=input-group-addon]")
        if (addon) addon.setAttribute("data-x", "hide")
        const ph = [...composer.querySelectorAll("*")].find((e) => e.children.length === 0 && (e.textContent ?? "").startsWith("Ask the agent"))
        if (ph) ph.textContent = "Only Local User can send in this chat"
        const box = composer.querySelector("[data-slot=input-group]")
        if (box) box.setAttribute("data-x", "disabled-box")
      } else {
        mark([composer])
      }
    }
    // Plan card buttons.
    const approve = byText("button", "Approve")[0]
    const row = approve?.parentElement
    if (row) {
      if (has("q2b")) {
        row.setAttribute("data-x", "waiting")
        row.innerHTML = '<p class="x-wait">Waiting for Local User to approve</p>'
      } else mark([row])
    }
    // Q3B: View only in the breadcrumb pill.
    if (has("q3b")) {
      const pill = q('[aria-label="Canvas options"]')[0]?.closest("ol")
      if (pill) {
        const s = document.createElement("span")
        s.className = "x-viewonly"
        s.innerHTML = '<svg width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z"/></svg>View only'
        pill.appendChild(s)
      }
    }
  }
