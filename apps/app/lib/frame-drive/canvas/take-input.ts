/**
 * The canvas's part of a gesture the Mac plays with real input (#1385): the
 * desktop shell sends the canvas window real mouse and key events, and these
 * make sure they land in the frame. Outside Interact a frame takes no pointer
 * (its overlay drags and selects the layer) and the canvas keeps the keyboard,
 * so for the moment a gesture lands the frame takes both, and the point the
 * shell aims at must hit the frame itself: one scrolled off, covered or in a
 * hidden window can't take a click (`window` is then null and the gesture
 * goes through the bridge instead).
 *
 * Self-contained, with no imports or module state, so the Mac's browser test
 * runs this same function in a canvas page of its own.
 */
export async function takeFrameInput(
  iframe: HTMLIFrameElement,
  /** A point in the frame's page (CSS px) the pointer will land on. */
  at: { x: number; y: number } | undefined,
  /** Let the frame take the pointer (or stop), as Interact does. */
  setTakesPointer: (on: boolean) => void
): Promise<{
  window: { x: number; y: number } | null
  release: () => void
}> {
  const before = document.activeElement
  if (at) {
    setTakesPointer(true)
    // Wait for the overlay to go and the frame to take pointer events.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
  }
  // Keys go to the focused frame.
  iframe.focus({ preventScroll: true })

  let point: { x: number; y: number } | null = null
  if (at && document.visibilityState === "visible") {
    // The page lays out at the frame's own size inside the zoomed canvas.
    const r = iframe.getBoundingClientRect()
    const scale = iframe.offsetWidth ? r.width / iframe.offsetWidth : 1
    const x = r.left + iframe.clientLeft * scale + at.x * scale
    const y = r.top + iframe.clientTop * scale + at.y * scale
    const inWindow = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight
    if (inWindow && document.elementFromPoint(x, y) === iframe) {
      point = { x, y }
    }
  }

  let released = false
  return {
    window: point,
    release() {
      if (released) return
      released = true
      if (at) setTakesPointer(false)
      // Give the keyboard back to a field the person was typing in. Otherwise
      // it stays in the frame, as after a person's click, so a menu or field
      // the gesture opened doesn't close on losing focus.
      const typing =
        before instanceof HTMLElement &&
        before !== iframe &&
        before.isConnected &&
        (before.isContentEditable ||
          before.nodeName === "INPUT" ||
          before.nodeName === "TEXTAREA")
      if (typing && document.activeElement === iframe) {
        before.focus({ preventScroll: true })
      }
    },
  }
}
