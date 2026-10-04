;(() => {
  // Talking back to the chat for Mockup pages (#1641), inlined into every
  // Mockup's srcdoc after the knobs and shared-state runtimes:
  //
  //   button.onclick = () => screenplay.draft("Picked B. Note on C: too dense")
  //
  // `draft(text)` fills the composer of the chat that made the Mockup with
  // `text`, for the person to edit and send. It acts only from a person's tap
  // or key press (the browser's transient user activation), so a page can never
  // write in someone's name on its own; the canvas checks again on its side.
  // Nothing is ever sent without the person.
  if (window.screenplay && window.screenplay.draft) return

  const MAX_DRAFT_CHARS = 8000

  // True while a tap or key press is being handled (or just was), as the
  // browser counts it for popups and clipboard writes.
  function fromGesture() {
    const activation = navigator.userActivation
    return !!activation && activation.isActive
  }

  function draft(text) {
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new Error("draft needs a non-empty string")
    }
    if (!fromGesture()) {
      console.warn(
        "[screenplay] draft() works only from a tap or key press; ignored."
      )
      return false
    }
    parent.postMessage(
      { type: "screenplay:draft", text: text.slice(0, MAX_DRAFT_CHARS) },
      "*"
    )
    return true
  }

  window.screenplay = Object.assign(window.screenplay || {}, { draft })
})()
