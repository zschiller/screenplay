;(() => {
  // The app's theme for Mockup pages, inlined into every Mockup's srcdoc
  // beside the chat and question runtimes:
  //
  //   screenplay.theme((scheme) => root.classList.toggle("dark", scheme === "dark"))
  //
  // `theme` calls back with "light" or "dark" once the canvas says which
  // theme the app is in, and again whenever it changes. The canvas doesn't
  // say on a live page, which everyone sees in one theme, so a page keeps
  // following `prefers-color-scheme` until it hears.
  if (window.screenplay && window.screenplay.theme) return

  const listeners = new Set()
  let current = null

  function theme(onChange) {
    if (typeof onChange === "function") {
      listeners.add(onChange)
      if (current) onChange(current)
    }
    return current
  }

  window.addEventListener("message", (e) => {
    const data = e.data
    if (!data || data.type !== "screenplay:theme-apply") return
    if (data.scheme !== "light" && data.scheme !== "dark") return
    if (data.scheme === current) return
    current = data.scheme
    for (const cb of listeners) {
      try {
        cb(current)
      } catch (err) {
        console.error(err)
      }
    }
  })
  parent.postMessage({ type: "screenplay:theme-request" }, "*")

  window.screenplay = Object.assign(window.screenplay || {}, { theme })
})()
