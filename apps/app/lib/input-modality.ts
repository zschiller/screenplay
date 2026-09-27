/**
 * Whether the user's last input was a pointer (mouse, touch, pen) rather than
 * the keyboard. Lets a surface that moves focus on open — a confirm focusing
 * its Cancel — hide the focus ring from mouse users while keeping it for
 * keyboard users, which the browser's own :focus-visible heuristic can't tell
 * apart once focus is moved by script from a menu.
 *
 * Listeners are installed once, in the capture phase, when this module loads.
 */
let lastWasPointer = false

if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    () => {
      lastWasPointer = true
    },
    true
  )
  document.addEventListener(
    "keydown",
    () => {
      lastWasPointer = false
    },
    true
  )
}

export function lastInputWasPointer(): boolean {
  return lastWasPointer
}
